import { afterEach, describe, expect, it, vi } from "vitest";

import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { makeCommitWithOutbox, makePublish } from "./commit";

type SentEvent = { id: string; name: string; data: unknown };

// One harness records every db/inngest interaction against a shared ordered log so a
// test can assert both *what* happened and *when* (inside the tx vs. post-commit).
function harness(opts: { sendThrows?: boolean; updateThrows?: boolean } = {}) {
	const log: string[] = [];
	const insertedRows: unknown[][] = [];
	const updates: Record<string, unknown>[] = [];
	const sends: SentEvent[] = [];

	const tx = {
		insert: () => ({
			values: (rows: unknown[]) => {
				log.push("tx.insert");
				insertedRows.push(rows);
				return Promise.resolve();
			},
		}),
	};

	const db = {
		transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
			log.push("tx.begin");
			const result = await cb(tx);
			log.push("tx.commit");
			return result;
		},
		update: () => ({
			set: (vals: Record<string, unknown>) => ({
				where: () => {
					log.push("db.update");
					updates.push(vals);
					return opts.updateThrows
						? Promise.reject(new Error("update failed"))
						: Promise.resolve();
				},
			}),
		}),
	};

	const inngest = {
		send: (payload: SentEvent) => {
			log.push("inngest.send");
			sends.push(payload);
			return opts.sendThrows
				? Promise.reject(new Error("send failed"))
				: Promise.resolve({ ids: [payload.id] });
		},
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		db: db as any,
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the inngest client.
		inngest: inngest as any,
		log,
		insertedRows,
		updates,
		sends,
	};
}

const event: OutboxEventDescriptor = {
	id: "11111111-1111-1111-1111-111111111111",
	name: "receipt/uploaded",
	data: { receiptId: "r1" },
};

afterEach(() => vi.restoreAllMocks());

describe("commitWithOutbox", () => {
	it("runs the canonical writes then the outbox insert inside one transaction", async () => {
		const h = harness();
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		await commit(async () => {
			h.log.push("writes");
		}, [event]);

		expect(h.log.slice(0, 4)).toEqual([
			"tx.begin",
			"writes",
			"tx.insert",
			"tx.commit",
		]);
		expect(h.insertedRows[0]).toEqual([
			{ id: event.id, eventName: event.name, payload: event.data },
		]);
	});

	it("sends each event post-commit with id = the outbox row id (the idempotency key)", async () => {
		const h = harness();
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		await commit(async () => {}, [event]);

		expect(h.sends).toEqual([
			{ id: event.id, name: event.name, data: event.data },
		]);
		expect(h.log.indexOf("inngest.send")).toBeGreaterThan(
			h.log.indexOf("tx.commit"),
		);
	});

	it("stamps processedAt when the send succeeds", async () => {
		const h = harness();
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		await commit(async () => {}, [event]);

		expect(h.updates).toHaveLength(1);
		expect(h.updates[0]?.processedAt).toBeInstanceOf(Date);
	});

	it("swallows a failing send: bumps attempts + lastError and leaves the row unacked", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness({ sendThrows: true });
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		await expect(commit(async () => {}, [event])).resolves.toBeUndefined();

		expect(h.updates).toHaveLength(1);
		expect(h.updates[0]).toHaveProperty("attempts");
		expect(h.updates[0]?.lastError).toBe("send failed");
		expect(h.updates[0]).not.toHaveProperty("processedAt");
	});

	// The ack runs after the tx has committed, so a throw there must never escape —
	// else the caller retries an already-durable write and duplicates rows + events.
	it("swallows a failing ack update: send succeeds, the processedAt write throws, commit still resolves", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = harness({ updateThrows: true });
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		await expect(commit(async () => {}, [event])).resolves.toBeUndefined();

		expect(h.sends).toHaveLength(1);
		expect(console.error).toHaveBeenCalled();
	});

	it("returns the writes callback's result unchanged", async () => {
		const h = harness();
		const commit = makeCommitWithOutbox({ db: h.db, inngest: h.inngest });

		const result = await commit(async () => "RESULT", [event]);

		expect(result).toBe("RESULT");
	});
});

describe("publish", () => {
	it("writes exactly one outbox row and sends it, with no other canonical write", async () => {
		const h = harness();
		const publish = makePublish({ db: h.db, inngest: h.inngest });

		await publish(event);

		expect(h.insertedRows).toEqual([
			[{ id: event.id, eventName: event.name, payload: event.data }],
		]);
		expect(h.sends).toHaveLength(1);
	});
});
