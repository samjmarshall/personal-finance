import { NonRetriableError, RetryAfterError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { CdrSyncError } from "./cdr.errors";
import { CdrInngestController } from "./cdr.inngest.controller";
import type { CdrSyncService } from "./cdr-sync.service";

type Declared = {
	opts: {
		id: string;
		retries: number;
		concurrency: { limit: number };
		triggers: unknown[];
	};
	handler: () => Promise<unknown>;
};

// Spy client records the declaration; the handler is kept so a test can invoke it
// the way Inngest would.
function harness(run: () => Promise<void> = async () => {}) {
	const declared: Declared[] = [];
	const inngest = {
		createFunction: (opts: Declared["opts"], handler: Declared["handler"]) => {
			declared.push({ opts, handler });
			return { id: () => opts.id };
		},
	};
	const service = { run: vi.fn(run) };
	const controller = new CdrInngestController({
		// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		inngest: inngest as any,
		service: service as unknown as CdrSyncService,
	});
	return { controller, declared, service };
}

async function thrownBy(handler: () => Promise<unknown>): Promise<unknown> {
	try {
		await handler();
	} catch (error) {
		return error;
	}
	throw new Error("expected the handler to throw");
}

describe("CdrInngestController", () => {
	it("declares the frozen cdr-sync cron and exposes it for serve", () => {
		const h = harness();

		expect(h.declared.map((d) => d.opts)).toEqual([
			{
				id: "cdr-sync",
				retries: 3,
				concurrency: { limit: 1 },
				triggers: [{ cron: "0 18 * * *" }],
			},
		]);
		expect(h.controller.functions).toEqual([h.controller.sync]);
	});

	it("routes the run to service.run", async () => {
		const h = harness();

		await h.declared[0]?.handler();

		expect(h.service.run).toHaveBeenCalledOnce();
	});

	describe("a failed run", () => {
		const fail = (error: unknown) => {
			const h = harness(async () => {
				throw error;
			});
			return thrownBy(() => h.declared[0]?.handler() as Promise<unknown>);
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
