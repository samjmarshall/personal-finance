import { SpanStatusCode } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	buildOutboxEvent,
	type OutboxEventDescriptor,
} from "~/server/inngest/events";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import type { OutboxRepository, OutboxRow } from "./outbox.repository";
import { OutboxService } from "./outbox.service";

type SentEvent = { id: string; name: string; data: unknown };
type LogEntry = { level: string; msg: string; attrs: LogAttributes };

// Business spans land on the ambient tracer; register a provider so start/end are
// recorded and the outbox.deliver / outbox.sweep.row spans can be asserted.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

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
	const logs: LogEntry[] = [];

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

	// Bound attrs merge under call attrs, like the real logger.
	const fakeLogger = (bound: Record<string, unknown>): Logger => ({
		debug: (msg, attrs = {}) =>
			logs.push({ level: "debug", msg, attrs: { ...bound, ...attrs } }),
		info: (msg, attrs = {}) =>
			logs.push({ level: "info", msg, attrs: { ...bound, ...attrs } }),
		warn: (msg, attrs = {}) =>
			logs.push({ level: "warn", msg, attrs: { ...bound, ...attrs } }),
		error: (msg, attrs = {}) =>
			logs.push({ level: "error", msg, attrs: { ...bound, ...attrs } }),
		with: (attrs) => fakeLogger({ ...bound, ...attrs }),
	});
	const logger = fakeLogger({});

	return {
		service: new OutboxService({
			repository,
			// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the inngest client.
			inngest: inngest as any,
			logger,
		}),
		log,
		sends,
		processed,
		failed,
		committed,
		logs,
	};
}

// Full stored-row shape: the fake must carry the internal columns
// (attempts/processedAt/lastError) a projection bug would leak to Inngest.
const row = (id: string, createdAt = new Date()): OutboxRow => ({
	id,
	name: "receipt/uploaded",
	data: { receiptId: id },
	createdAt,
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

	// adr016: the minted descriptor rides to Inngest byte-for-byte, `_trace` and all.
	it("sends the minted descriptor unchanged, carrying its _trace pocket", async () => {
		const h = harness([]);
		const minted = buildOutboxEvent("receipt/uploaded", { receiptId: 1 });

		await h.service.commit(
			async () => {},
			() => [minted],
		);

		expect(h.sends).toEqual([minted]);
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

	it("logs one 'outbox delivered' heartbeat once the send is acked", async () => {
		const h = harness([]);

		await h.service.commit(
			async () => {},
			() => [event],
		);

		expect(h.logs.filter((l) => l.msg === "outbox delivered")).toEqual([
			{
				level: "info",
				msg: "outbox delivered",
				attrs: {
					"outbox.event_id": event.id,
					"outbox.event_name": event.name,
					"outbox.delivery_context": "send",
				},
			},
		]);
	});

	it("opens one outbox.deliver span per send carrying the event id", async () => {
		const h = harness([]);

		await h.service.commit(
			async () => {},
			() => [event],
		);

		const deliverSpans = exporter
			.getFinishedSpans()
			.filter((s) => s.name === "outbox.deliver");
		expect(deliverSpans).toHaveLength(1);
		expect(deliverSpans[0]?.attributes["outbox.event_id"]).toBe(event.id);
	});

	it("swallows a failing send: records the message and leaves the row unacked", async () => {
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
		const h = harness([], { markProcessedThrows: true });

		await expect(
			h.service.commit(
				async () => {},
				() => [event],
			),
		).resolves.toBeUndefined();

		expect(h.sends).toHaveLength(1);
		expect(h.logs).toContainEqual(
			expect.objectContaining({
				level: "error",
				msg: "outbox ack failed",
				attrs: expect.objectContaining({ "outbox.event_id": event.id }),
			}),
		);
		// The heartbeat must not claim delivery for a row that never acked.
		expect(h.logs.some((l) => l.msg === "outbox delivered")).toBe(false);
	});

	it("fails the outbox.deliver span when the send succeeds but the ack write throws", async () => {
		const h = harness([], { markProcessedThrows: true });

		await h.service.commit(
			async () => {},
			() => [event],
		);

		const deliver = exporter
			.getFinishedSpans()
			.find((s) => s.name === "outbox.deliver");
		// Sent-but-unacked isn't delivered, so the trace must read ERROR not a false OK.
		expect(deliver?.status.code).toBe(SpanStatusCode.ERROR);
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

	// adr016: a late re-delivery must carry the producer's carrier, not the cron's.
	it("re-sends a stored row's _trace pocket unchanged", async () => {
		const carrier = { traceparent: "00-abc-def-01" };
		const stuck: OutboxRow = {
			...row("r1"),
			data: { receiptId: "r1", _trace: carrier },
		};
		const h = harness([stuck]);

		await h.service.sweep();

		expect(h.sends).toEqual([
			{
				id: "r1",
				name: "receipt/uploaded",
				data: { receiptId: "r1", _trace: carrier },
			},
		]);
	});

	it("opens one outbox.sweep.row span per swept row carrying the event id", async () => {
		const h = harness([row("r1"), row("r2")]);

		await h.service.sweep();

		const sweepSpans = exporter
			.getFinishedSpans()
			.filter((s) => s.name === "outbox.sweep.row");
		expect(sweepSpans).toHaveLength(2);
		expect(
			sweepSpans.map((s) => s.attributes["outbox.event_id"]).sort(),
		).toEqual(["r1", "r2"]);
	});

	it("warns once with event.name outbox.sweep.stuck when a re-send fails at the retry threshold", async () => {
		const h = harness([{ ...row("r1"), attempts: 2 }], { sendThrows: true });

		await h.service.sweep();

		const stuck = h.logs.filter(
			(l) => l.attrs["event.name"] === "outbox.sweep.stuck",
		);
		expect(stuck).toHaveLength(1);
		expect(stuck[0]?.level).toBe("warn");
		expect(stuck[0]?.attrs["outbox.event_id"]).toBe("r1");
		expect(stuck[0]?.attrs["outbox.attempts"]).toBe(3);
	});

	// A row that finally goes through is healed, not stuck — no false alert.
	it("does not warn stuck for a past-threshold row this sweep delivers", async () => {
		const h = harness([{ ...row("r1"), attempts: 5 }]);

		await h.service.sweep();

		expect(
			h.logs.some((l) => l.attrs["event.name"] === "outbox.sweep.stuck"),
		).toBe(false);
	});

	// An ack that keeps failing must still climb toward stuck.
	it("warns stuck for a past-threshold row whose ack fails", async () => {
		const h = harness([{ ...row("r1"), attempts: 2 }], {
			markProcessedThrows: true,
		});

		await h.service.sweep();

		expect(
			h.logs.some((l) => l.attrs["event.name"] === "outbox.sweep.stuck"),
		).toBe(true);
	});

	// Regression: age alone must not flag stuck — an old row still on its first
	// re-delivery (low attempts) is healthy, not poison.
	it("does not warn stuck for an old row still within its early attempts", async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		const h = harness([{ ...row("r1", twoHoursAgo), attempts: 1 }]);

		await h.service.sweep();

		expect(
			h.logs.some((l) => l.attrs["event.name"] === "outbox.sweep.stuck"),
		).toBe(false);
	});

	it("swallows a failing send: records the error message and leaves the row unacked", async () => {
		const h = harness([row("r1")], { sendThrows: true });

		const result = await h.service.sweep();

		expect(result).toEqual({ delivered: 0, failed: 1 });
		expect(h.failed).toEqual([{ id: "r1", message: "boom" }]);
		expect(h.processed).toEqual([]);
	});

	// A throw in the post-send ack must never escape the sweep — else one stuck row
	// aborts the whole run and starves every later row behind it. And a sent-but-
	// unacked row counts as failed, not delivered: it stays unsent, next sweep retries.
	it("counts a send-but-unacked row as failed, and the sweep still resolves", async () => {
		const h = harness([row("r1"), row("r2")], { markProcessedThrows: true });

		await expect(h.service.sweep()).resolves.toEqual({
			delivered: 0,
			failed: 2,
		});
		expect(h.sends).toHaveLength(2);
		expect(h.logs.filter((l) => l.msg === "outbox ack failed")).toHaveLength(2);
		// The heartbeat must not claim delivery for a row that never acked.
		expect(h.logs.some((l) => l.msg === "outbox delivered")).toBe(false);
		// The failed ack bumps attempts like a failed send.
		expect(h.failed).toEqual([
			{ id: "r1", message: "ack failed: update failed" },
			{ id: "r2", message: "ack failed: update failed" },
		]);
	});

	it("swallows a failing failure-record: send throws, markFailed throws, sweep still resolves", async () => {
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
