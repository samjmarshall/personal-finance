import { describe, expect, it, vi } from "vitest";
import { OutboxInngestController } from "./outbox.inngest.controller";
import type { OutboxService } from "./outbox.service";

type Declared = {
	opts: { id: string; triggers: unknown[] };
	handler: () => Promise<unknown>;
};

// Spy client records each declaration; the handler is kept so a test can invoke it
// the way Inngest would and see which service method it routes to.
function harness() {
	const declared: Declared[] = [];
	const inngest = {
		createFunction: (opts: Declared["opts"], handler: Declared["handler"]) => {
			declared.push({ opts, handler });
			return { id: () => opts.id };
		},
	};
	const service = {
		sweep: vi.fn(async () => ({ delivered: 1, failed: 0 })),
		prune: vi.fn(async () => ({ deleted: 3 })),
	};

	const controller = new OutboxInngestController({
		// biome-ignore lint/suspicious/noExplicitAny: spy stands in for the inngest client.
		inngest: inngest as any,
		service: service as unknown as OutboxService,
	});

	return { controller, declared, service };
}

describe("OutboxInngestController", () => {
	it("declares the two cron functions in order and exposes them for serve", () => {
		const h = harness();

		expect(h.declared.map((d) => d.opts.id)).toEqual([
			"outbox-sweep",
			"outbox-prune",
		]);
		expect(h.controller.functions).toEqual([
			h.controller.sweep,
			h.controller.prune,
		]);
	});

	it("routes the sweep run to service.sweep and returns its result", async () => {
		const h = harness();

		await expect(h.declared[0]?.handler()).resolves.toEqual({
			delivered: 1,
			failed: 0,
		});
		expect(h.service.sweep).toHaveBeenCalledOnce();
		expect(h.service.prune).not.toHaveBeenCalled();
	});

	it("routes the prune run to service.prune and returns its result", async () => {
		const h = harness();

		await expect(h.declared[1]?.handler()).resolves.toEqual({ deleted: 3 });
		expect(h.service.prune).toHaveBeenCalledOnce();
		expect(h.service.sweep).not.toHaveBeenCalled();
	});
});
