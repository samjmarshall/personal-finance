import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import { DrizzleOutboxRepository, type OutboxRow } from "./outbox.repository";
import { outbox } from "./outbox.schema";

const dialect = new PgDialect();
const render = (cond: unknown) =>
	// biome-ignore lint/suspicious/noExplicitAny: dialect renders a drizzle SQL condition to text.
	dialect.sqlToQuery(cond as any).sql;

// Chain-capturing fake db: each builder chain resolves to the staged result (standing
// in for what the real WHERE would return) and records the WHERE/ORDER BY/SET it was
// given, so a test can assert the SQL shape without a live DB. `transaction` hands the
// callback a fake tx and logs begin/commit around it so ordering can be asserted.
function harness({
	rows = [],
	deleted = [],
}: {
	rows?: OutboxRow[];
	deleted?: { id: string }[];
} = {}) {
	let selectWhere: unknown;
	let orderByArg: unknown;
	let deleteWhere: unknown;
	const updates: { set: Record<string, unknown>; where: unknown }[] = [];
	const log: string[] = [];
	const inserted: { table: unknown; rows: unknown[] }[] = [];

	const tx = {
		insert: (table: unknown) => ({
			values: (values: unknown[]) => {
				log.push("tx.insert");
				inserted.push({ table, rows: values });
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
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					selectWhere = cond;
					return {
						orderBy: (arg: unknown) => {
							orderByArg = arg;
							return Promise.resolve(rows);
						},
					};
				},
			}),
		}),
		update: () => ({
			set: (vals: Record<string, unknown>) => ({
				where: (cond: unknown) => {
					updates.push({ set: vals, where: cond });
					return Promise.resolve();
				},
			}),
		}),
		delete: () => ({
			where: (cond: unknown) => {
				deleteWhere = cond;
				return { returning: () => Promise.resolve(deleted) };
			},
		}),
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		repository: new DrizzleOutboxRepository({ db: db as any }),
		updates,
		log,
		inserted,
		getSelectWhere: () => selectWhere,
		getOrderBy: () => orderByArg,
		getDeleteWhere: () => deleteWhere,
	};
}

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

describe("DrizzleOutboxRepository", () => {
	describe("commit", () => {
		it("runs the canonical writes then the outbox insert inside one transaction", async () => {
			const h = harness();

			await h.repository.commit(
				async () => {
					h.log.push("writes");
				},
				() => [event],
			);

			expect(h.log).toEqual(["tx.begin", "writes", "tx.insert", "tx.commit"]);
			expect(h.inserted).toEqual([{ table: outbox, rows: [event] }]);
		});

		// The events come from the writes' result: that is what lets a payload carry a
		// DB-generated id the insert only produced inside this transaction.
		it("derives the events from the writes' result and returns both", async () => {
			const h = harness();

			const outcome = await h.repository.commit(
				async () => [{ id: 7 }],
				(rows) =>
					rows.map((r) => ({ ...event, data: { receiptId: String(r.id) } })),
			);

			expect(outcome).toEqual({
				result: [{ id: 7 }],
				events: [{ ...event, data: { receiptId: "7" } }],
			});
		});

		it("skips the outbox insert when no events are derived", async () => {
			const h = harness();

			await h.repository.commit(
				async () => {},
				() => [],
			);

			expect(h.log).toEqual(["tx.begin", "tx.commit"]);
			expect(h.inserted).toEqual([]);
		});
	});

	describe("findUnsent", () => {
		it("returns the full stored rows", async () => {
			const rows = [row("r1"), row("r2")];
			const h = harness({ rows });

			await expect(h.repository.findUnsent()).resolves.toEqual(rows);
		});

		it("only queries unacked rows past the 30s floor, oldest first", async () => {
			const h = harness();

			await h.repository.findUnsent();

			const where = render(h.getSelectWhere());
			expect(where).toContain("is null");
			expect(where).toContain("30 seconds");
			expect(h.getOrderBy()).toBe(outbox.createdAt);
		});
	});

	describe("markProcessed", () => {
		it("stamps processedAt on the one row", async () => {
			const h = harness();

			await h.repository.markProcessed("r1");

			expect(h.updates).toHaveLength(1);
			expect(h.updates[0]?.set.processedAt).toBeInstanceOf(Date);
			expect(render(h.updates[0]?.where)).toContain('"id" =');
		});
	});

	describe("markFailed", () => {
		it("bumps attempts + records lastError, leaving the row unacked", async () => {
			const h = harness();

			await h.repository.markFailed("r1", "boom");

			expect(h.updates).toHaveLength(1);
			expect(h.updates[0]?.set).toHaveProperty("attempts");
			expect(h.updates[0]?.set.lastError).toBe("boom");
			expect(h.updates[0]?.set).not.toHaveProperty("processedAt");
			expect(render(h.updates[0]?.where)).toContain('"id" =');
		});
	});

	describe("deleteProcessed", () => {
		it("returns the deleted count", async () => {
			const h = harness({ deleted: [{ id: "a" }, { id: "b" }] });

			await expect(h.repository.deleteProcessed()).resolves.toBe(2);
		});

		it("targets only rows processed over 7 days ago — never unacked/stuck rows", async () => {
			const h = harness();

			await h.repository.deleteProcessed();

			const where = render(h.getDeleteWhere());
			expect(where).toContain("processedAt");
			expect(where).toContain("7 days");
			// `processed_at < …` is NULL-false, so unacked rows can't match — no `is null` branch.
			expect(where).not.toContain("is null");
		});
	});
});
