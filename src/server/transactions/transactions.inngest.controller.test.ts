import { describe, expect, it, vi } from "vitest";
import type { DuplicateApplyService } from "./duplicate-apply.service";
import { TransactionsInngestController } from "./transactions.inngest.controller";

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
			event: { data: { event: { data: { applyId: number } } } };
			error: Error;
		}) => Promise<unknown>;
	};
	handler: (ctx: {
		event: { data: { applyId: number } };
		step: Step;
	}) => Promise<unknown>;
};

// Spy client records the declaration; the handler is kept so a test can invoke it
// the way Inngest would.
function harness(
	batches: (() => Promise<{ more: boolean }>)[] = [
		async () => ({ more: false }),
	],
) {
	const declared: Declared[] = [];
	const inngest = {
		createFunction: (opts: Declared["opts"], handler: Declared["handler"]) => {
			declared.push({ opts, handler });

			return { id: () => opts.id };
		},
	};
	const queue = [...batches];
	const service = {
		applyBatch: vi.fn(() => {
			const next = queue.shift();

			if (!next) throw new Error("no batch staged");

			return next();
		}),
		finish: vi.fn(async () => {}),
		fail: vi.fn(async () => {}),
	};
	const controller = new TransactionsInngestController({
		// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		inngest: inngest as any,
		service: service as unknown as DuplicateApplyService,
	});
	const [apply] = declared;

	if (!apply) throw new Error("expected duplicate-apply declared");

	return { controller, declared, service, apply };
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

const more = async () => ({ more: true });
const last = async () => ({ more: false });
const applyEvent = { data: { applyId: 7 } };

describe("TransactionsInngestController", () => {
	it("declares the frozen duplicate-apply event on its own slot", () => {
		const h = harness();

		expect(h.declared.map((d) => d.opts)).toEqual([
			{
				id: "duplicate-apply",
				retries: 3,
				concurrency: { limit: 1, key: '"duplicate-apply"', scope: "env" },
				triggers: [{ event: "duplicate/apply.requested" }],
				onFailure: expect.any(Function),
			},
		]);
		expect(h.controller.functions).toEqual([h.controller.apply]);
	});

	it("runs a numbered step per batch until a short one, then finishes", async () => {
		const h = harness([more, more, last]);
		const { ids, step } = fakeStep();

		await h.apply.handler({ event: applyEvent, step });

		expect(ids).toEqual(["batch-0", "batch-1", "batch-2", "finish"]);
		expect(h.service.applyBatch.mock.calls).toEqual([[7], [7], [7]]);
		expect(h.service.finish).toHaveBeenCalledWith(7);
	});

	// Inngest replays a finished step's saved result, so a retry never redoes it.
	it("doesn't rerun a finished batch when a later one fails once", async () => {
		const h = harness([
			more,
			async () => {
				throw new Error("db blip");
			},
			last,
		]);
		const saved = new Map<string, unknown>();
		const step: Step = {
			run: async <T>(id: string, work: () => Promise<T>) => {
				if (!saved.has(id)) saved.set(id, await work());

				return saved.get(id) as T;
			},
		};

		await expect(h.apply.handler({ event: applyEvent, step })).rejects.toThrow(
			"db blip",
		);
		await h.apply.handler({ event: applyEvent, step });

		expect(h.service.applyBatch).toHaveBeenCalledTimes(3);
		expect(h.service.finish).toHaveBeenCalledOnce();
	});

	it("fails the Apply once retries run out", async () => {
		const h = harness();

		const error = new Error("boom");

		await h.apply.opts.onFailure?.({
			event: { data: { event: applyEvent } },
			error,
		});

		expect(h.service.fail).toHaveBeenCalledWith(7, error);
	});
});
