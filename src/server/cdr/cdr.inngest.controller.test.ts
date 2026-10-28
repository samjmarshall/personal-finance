import { NonRetriableError, RetryAfterError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { CdrSyncError } from "./cdr.errors";
import { CdrInngestController } from "./cdr.inngest.controller";
import type { CdrSyncService, ImportPlan } from "./cdr-sync.service";

type Step = {
	run: <T>(id: string, work: () => Promise<T>) => Promise<T>;
};

type Declared = {
	opts: {
		id: string;
		retries: number;
		concurrency: { limit: number; key: string; scope: string };
		triggers: unknown[];
		onFailure?: (ctx: {
			event: { data: { event: { data: { importId: number } } } };
			error: Error;
		}) => Promise<unknown>;
	};
	handler: (ctx: {
		event: { data: { importId: number } };
		step: Step;
	}) => Promise<unknown>;
};

const SHARED = { limit: 1, key: '"cdr-sync"', scope: "env" };

const PLAN: ImportPlan = {
	liveAccountIds: ["acct_1", "acct_2"],
	chunks: [
		{
			accountId: "acct_1",
			accountName: "Everyday",
			from: "2026-01-01",
			to: "2026-03-31",
		},
		{
			accountId: "acct_2",
			accountName: "Card",
			from: "2026-01-01",
			to: "2026-03-31",
		},
	],
};

// Spy client records the declaration; the handler is kept so a test can invoke it
// the way Inngest would.
function harness(
	fakes: Partial<Record<keyof CdrSyncService, () => Promise<unknown>>> = {},
) {
	const declared: Declared[] = [];
	const inngest = {
		createFunction: (opts: Declared["opts"], handler: Declared["handler"]) => {
			declared.push({ opts, handler });
			return { id: () => opts.id };
		},
	};
	const service = {
		run: vi.fn(fakes.run ?? (async () => {})),
		planImport: vi.fn(fakes.planImport ?? (async () => PLAN)),
		importChunk: vi.fn(fakes.importChunk ?? (async () => ({}))),
		finishImport: vi.fn(fakes.finishImport ?? (async () => {})),
		failImport: vi.fn(fakes.failImport ?? (async () => {})),
	};
	const controller = new CdrInngestController({
		// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		inngest: inngest as any,
		service: service as unknown as CdrSyncService,
	});
	const [sync, imported] = declared;
	if (!sync || !imported) throw new Error("expected both functions declared");
	return { controller, declared, service, sync, imported };
}

// Runs each step inline, as Inngest does on a first attempt, and records its id.
function fakeStep() {
	const ids: string[] = [];
	const step: Step = {
		run: (id, work) => {
			ids.push(id);
			return work();
		},
	};
	return { ids, step };
}

const importEvent = { data: { importId: 7 } };

async function thrownBy(handler: () => Promise<unknown>): Promise<unknown> {
	try {
		await handler();
	} catch (error) {
		return error;
	}
	throw new Error("expected the handler to throw");
}

describe("CdrInngestController", () => {
	it("declares the frozen cdr-sync cron and cdr-import event on one shared slot", () => {
		const h = harness();

		expect(h.declared.map((d) => d.opts)).toEqual([
			{
				id: "cdr-sync",
				retries: 3,
				concurrency: SHARED,
				triggers: [{ cron: "0 18 * * *" }],
			},
			{
				id: "cdr-import",
				retries: 3,
				concurrency: SHARED,
				triggers: [{ event: "cdr/import.requested" }],
				onFailure: expect.any(Function),
			},
		]);
		expect(h.controller.functions).toEqual([
			h.controller.sync,
			h.controller.import,
		]);
	});

	it("routes the run to service.run", async () => {
		const h = harness();

		await h.sync.handler({ event: importEvent, step: fakeStep().step });

		expect(h.service.run).toHaveBeenCalledOnce();
	});

	describe("cdr-import", () => {
		it("plans, runs one stable-id step per chunk, then finishes", async () => {
			const h = harness();
			const { ids, step } = fakeStep();

			await h.imported.handler({ event: importEvent, step });

			expect(ids).toEqual([
				"plan",
				"chunk-acct_1-2026-01-01",
				"chunk-acct_2-2026-01-01",
				"finish",
			]);
			expect(h.service.planImport).toHaveBeenCalledWith(7);
			expect(h.service.importChunk.mock.calls).toEqual([
				[7, PLAN.chunks[0], PLAN.liveAccountIds],
				[7, PLAN.chunks[1], PLAN.liveAccountIds],
			]);
			expect(h.service.finishImport).toHaveBeenCalledWith(7);
		});

		it("runs no chunk and no finish on a repeat delivery", async () => {
			const h = harness({ planImport: async () => null });
			const { ids, step } = fakeStep();

			await h.imported.handler({ event: importEvent, step });

			expect(ids).toEqual(["plan"]);
			expect(h.service.importChunk).not.toHaveBeenCalled();
			expect(h.service.finishImport).not.toHaveBeenCalled();
		});

		it("maps a chunk's error like cdr-sync", async () => {
			const cause = new CdrSyncError("429", {
				retryable: true,
				retryAfterMs: 30_000,
			});
			const h = harness({
				importChunk: async () => {
					throw cause;
				},
			});

			const error = await thrownBy(() =>
				h.imported.handler({ event: importEvent, step: fakeStep().step }),
			);

			expect(error).toBeInstanceOf(RetryAfterError);
			expect(error).toMatchObject({ retryAfter: "30", cause });
		});

		it("fails the import with the final error once retries run out", async () => {
			const h = harness();

			await h.imported.opts.onFailure?.({
				event: { data: { event: importEvent } },
				error: new Error("This import is too big for one run."),
			});

			expect(h.service.failImport).toHaveBeenCalledWith(
				7,
				"This import is too big for one run.",
			);
		});
	});

	describe("a failed run", () => {
		const fail = (error: unknown) => {
			const h = harness({
				run: async () => {
					throw error;
				},
			});
			return thrownBy(() =>
				h.sync.handler({ event: importEvent, step: fakeStep().step }),
			);
		};

		it("retries after Retry-After, rounded to whole seconds", async () => {
			const cause = new CdrSyncError("429", {
				retryable: true,
				retryAfterMs: 30_000,
			});

			const error = await fail(cause);

			expect(error).toBeInstanceOf(RetryAfterError);
			expect(error).toMatchObject({ retryAfter: "30", cause });
		});

		it("still retries at exactly one hour", async () => {
			const cause = new CdrSyncError("429", {
				retryable: true,
				retryAfterMs: 3_600_000,
			});

			expect(await fail(cause)).toMatchObject({ retryAfter: "3600" });
		});

		it("leaves a wait over one hour to the next daily cron", async () => {
			const cause = new CdrSyncError("429", {
				retryable: true,
				retryAfterMs: 3_600_001,
			});

			const error = await fail(cause);

			expect(error).toBeInstanceOf(NonRetriableError);
			expect(error).toMatchObject({ cause });
		});

		it("fails at once when retrying would fail the same way", async () => {
			const cause = new CdrSyncError("mapping", { retryable: false });

			const error = await fail(cause);

			expect(error).toBeInstanceOf(NonRetriableError);
			expect(error).toMatchObject({ cause });
		});

		it("rethrows a retryable error with no wait unchanged, for Inngest's backoff", async () => {
			const cause = new CdrSyncError("503", { retryable: true });

			expect(await fail(cause)).toBe(cause);
		});

		it("rethrows any other error unchanged", async () => {
			const cause = new Error("db down");

			expect(await fail(cause)).toBe(cause);
		});
	});
});
