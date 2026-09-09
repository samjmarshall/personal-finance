import { describe, expect, it, vi } from "vitest";
import { ReceiptsController } from "./receipts.controller";
import type { ReceiptsService } from "./receipts.service";

type Declared = {
	opts: {
		id: string;
		retries: number;
		concurrency: unknown;
		triggers: unknown[];
	};
	handler: (ctx: {
		event: { data: { receiptId: number } };
		attempt: number;
	}) => Promise<unknown>;
};

// Spy client records the declaration; the handler is kept so a test can invoke it
// the way Inngest would, with an `attempt` counter, and see what reaches the service.
function harness() {
	const declared: Declared[] = [];
	const inngest = {
		createFunction: (opts: Declared["opts"], handler: Declared["handler"]) => {
			declared.push({ opts, handler });
			return { id: () => opts.id };
		},
	};
	const service = { process: vi.fn(async () => {}) };

	const controller = new ReceiptsController({
		// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		inngest: inngest as any,
		service: service as unknown as ReceiptsService,
	});

	return { controller, declared, service };
}

describe("ReceiptsController", () => {
	it("declares process-receipt with its retry budget, per-receipt serialisation and three triggers", () => {
		const h = harness();

		expect(h.declared).toHaveLength(1);
		expect(h.declared[0]?.opts).toEqual({
			id: "process-receipt",
			retries: 3,
			concurrency: { key: "event.data.receiptId", limit: 1 },
			triggers: [
				{ event: "receipt/uploaded" },
				{ event: "receipt/retry" },
				{ event: "receipt/email.received" },
			],
		});
		expect(h.controller.functions).toEqual([h.controller.process]);
	});

	it("routes a run to service.process with the event's receiptId", async () => {
		const h = harness();

		await h.declared[0]?.handler({
			event: { data: { receiptId: 7 } },
			attempt: 0,
		});

		expect(h.service.process).toHaveBeenCalledWith(7, {
			isFinalAttempt: false,
		});
	});

	// `attempt` is zero-based, so the last of `retries` re-runs is attempt === retries.
	it("flags the final attempt once the retry budget is spent", async () => {
		const h = harness();

		await h.declared[0]?.handler({
			event: { data: { receiptId: 7 } },
			attempt: 3,
		});

		expect(h.service.process).toHaveBeenCalledWith(7, {
			isFinalAttempt: true,
		});
	});
});
