import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import type { OutboxRepository, OutboxRow } from "./outbox.repository";
import { OutboxService } from "./outbox.service";

type SentEvent = { id: string; name: string; data: unknown };

// Fake repository is a plain object literal against the interface — no db, no casts.
// Each write records its arguments, and every interaction lands on one ordered log,
// so a test can assert both the bookkeeping around a send and when it happened
// (inside the commit vs. after it).
function harness(
	rows: OutboxRow[],
	opts: {
		sendThrows?: boolean;
		markProcessedThrows?: boolean;
		markFailedThrows?: boolean;
		deleted?: number;
	} = {},
) {
	const log: string[] = [];
	const sends: SentEvent[] = [];
	const processed: string[] = [];
	const failed: { id: string; message: string }[] = [];
	const committed: OutboxEventDescriptor[][] = [];

	const repository: OutboxRepository = {
		commit: async (writes, events) => {
			log.push("repository.commit");
			const result = await writes({} as never);
			const enqueued = events(result);
			committed.push(enqueued);
			return { result, events: enqueued };
		},
		findUnsent: async () => rows,
		markProcessed: async (id) => {
			log.push("markProcessed");
			if (opts.markProcessedThrows) throw new Error("update failed");
			processed.push(id);
		},
		markFailed: async (id, message) => {
			log.push("markFailed");
			if (opts.markFailedThrows) throw new Error("update failed");
			failed.push({ id, message });
		},
		deleteProcessed: async () => opts.deleted ?? 0,
	};

	const inngest = {
		send: async (event: SentEvent) => {
			log.push("inngest.send");
			sends.push(event);
			if (opts.sendThrows) throw new Error("boom");
			return { ids: [event.id] };
		},
	};

	return {
		service: new OutboxService({
			repository,
			// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the inngest client.
			inngest: inngest as any,
		}),
		log,
		sends,
		processed,
		failed,
		committed,
	};
}

// Full stored-row shape: the fake must carry the internal columns
// (attempts/processedAt/lastError) a projection bug would leak to Inngest.
const row = (id: string): OutboxRow => ({
	id,
	name: "receipt/uploaded",
	data: { receiptId: id },
	createdAt: new Date(),
	processedAt: null,
	attempts: 0,
	lastError: null,
});

const event: OutboxEventDescriptor = {
	id: "11111111-1111-1111-1111-111111111111",
	name: "receipt/uploaded",
	data: { receiptId: "r1" },
};

afterEach(() => vi.restoreAllMocks());

describe("OutboxService.commit", () => {
	it("hands the writes and event derivation to the repository as one commit", async () => {
		const h = harness([]);
		const writes = async () => "RESULT";
		const events = () => [event];

		await h.service.commit(writes, events);

		expect(h.committed).toEqual([[event]]);
	});

	it("sends each event only after the commit, with id = the outbox row id (the idempotency key)", async () => {
		const h = harness([]);

		await h.service.commit(
			async () => {},
			() => [event],
		);

		expect(h.sends).toEqual([
			{ id: event.id, name: event.name, data: event.data },
		]);
		expect(h.log.indexOf("inngest.send")).toBeGreaterThan(
			h.log.indexOf("repository.commit"),
		);
	});

	it("marks the row processed when the send succeeds", async () => {
		const h = harness([]);

		await h.service.commit(
			async () => {},
			() => [event],
		);

		expect(h.processed).toEqual([event.id]);
		expect(h.failed).toEqual([]);
	});

	it("swallows a failing send: records the message and leaves the row unacked", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness([], { sendThrows: true });

		await expect(
			h.service.commit(
				async () => {},
				() => [event],
			),
		).resolves.toBeUndefined();

		expect(h.failed).toEqual([{ id: event.id, message: "boom" }]);
		expect(h.processed).toEqual([]);
	});

	// The ack runs after the tx has committed, so a throw there must never escape —
	// else the caller retries an already-durable write and duplicates rows + events.
	it("swallows a failing ack: send succeeds, markProcessed throws, commit still resolves", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness([], { markProcessedThrows: true });

		await expect(
			h.service.commit(
				async () => {},
				() => [event],
			),
		).resolves.toBeUndefined();

		expect(h.sends).toHaveLength(1);
		expect(console.error).toHaveBeenCalled();
	});

	it("returns the writes' result unchanged", async () => {
		const h = harness([]);

		await expect(
			h.service.commit(
				async () => "RESULT",
				() => [event],
			),
		).resolves.toBe("RESULT");
	});

	it("sends nothing when the writes derive no events", async () => {
		const h = harness([]);

		await h.service.commit(
			async () => {},
			() => [],
		);

		expect(h.sends).toEqual([]);
		expect(h.processed).toEqual([]);
	});
});

describe("OutboxService.publish", () => {
	it("commits exactly one outbox row with no other canonical write, then sends it", async () => {
		const h = harness([]);

		await h.service.publish(event);

		expect(h.committed).toEqual([[event]]);
		expect(h.sends).toHaveLength(1);
		expect(h.processed).toEqual([event.id]);
	});
});

describe("OutboxService.sweep", () => {
	it("sends each due row with id = the outbox row id, then marks it processed", async () => {
		const h = harness([row("r1"), row("r2")]);

		const result = await h.service.sweep();

		expect(result).toEqual({ delivered: 2, failed: 0 });
		expect(h.sends).toEqual([
			{ id: "r1", name: "receipt/uploaded", data: { receiptId: "r1" } },
			{ id: "r2", name: "receipt/uploaded", data: { receiptId: "r2" } },
		]);
		// Only the wire fields cross to Inngest — internal columns
		// (attempts/processedAt/lastError) must never ride along.
		for (const sent of h.sends) {
			expect(Object.keys(sent).sort()).toEqual(["data", "id", "name"]);
		}
		expect(h.processed).toEqual(["r1", "r2"]);
		expect(h.failed).toEqual([]);
	});

	it("swallows a failing send: records the error message and leaves the row unacked", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness([row("r1")], { sendThrows: true });

		const result = await h.service.sweep();

		expect(result).toEqual({ delivered: 0, failed: 1 });
		expect(h.failed).toEqual([{ id: "r1", message: "boom" }]);
		expect(h.processed).toEqual([]);
	});

	// A throw in the post-send ack must never escape the sweep — else one stuck row
	// aborts the whole run and starves every later row behind it.
	it("swallows a failing ack: send succeeds, markProcessed throws, sweep still resolves", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness([row("r1"), row("r2")], { markProcessedThrows: true });

		await expect(h.service.sweep()).resolves.toEqual({
			delivered: 2,
			failed: 0,
		});
		expect(h.sends).toHaveLength(2);
		expect(console.error).toHaveBeenCalled();
	});

	it("swallows a failing failure-record: send throws, markFailed throws, sweep still resolves", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness([row("r1"), row("r2")], {
			sendThrows: true,
			markFailedThrows: true,
		});

		await expect(h.service.sweep()).resolves.toEqual({
			delivered: 0,
			failed: 2,
		});
		expect(h.sends).toHaveLength(2);
	});

	it("does nothing when no rows are due", async () => {
		const h = harness([]);

		await expect(h.service.sweep()).resolves.toEqual({
			delivered: 0,
			failed: 0,
		});
		expect(h.sends).toEqual([]);
	});
});

describe("OutboxService.prune", () => {
	it("returns the repository's deleted count", async () => {
		const h = harness([], { deleted: 3 });

		await expect(h.service.prune()).resolves.toEqual({ deleted: 3 });
	});
});
