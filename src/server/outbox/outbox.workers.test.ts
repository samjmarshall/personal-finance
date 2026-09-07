import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { outbox } from "./outbox.schema";
import { makeRunPrune, makeRunSweep } from "./outbox.workers";

// Full stored-row shape: the sweep selects `*`, so the fake must carry the internal
// columns (attempts/processedAt/lastError) a projection bug would leak to Inngest.
type OutboxRow = typeof outbox.$inferSelect;

const dialect = new PgDialect();
const render = (cond: unknown) =>
	// biome-ignore lint/suspicious/noExplicitAny: dialect renders a drizzle SQL condition to text.
	dialect.sqlToQuery(cond as any).sql;

// Fake db for the sweep core: the select chain resolves to the staged rows (standing
// in for what the real WHERE would return) and captures the WHERE/ORDER BY so a test
// can assert the age/ack floor without a live DB. `update` records each set() payload
// in call order — row i's mark corresponds to updates[i] (rows are processed in order).
function sweepHarness(
	rows: OutboxRow[],
	opts: { updateThrows?: boolean } = {},
) {
	let whereCond: unknown;
	let orderByArg: unknown;
	const updates: Record<string, unknown>[] = [];

	const db = {
		select: () => ({
			from: () => ({
				where: (cond: unknown) => {
					whereCond = cond;
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
				where: () => {
					updates.push(vals);
					return opts.updateThrows
						? Promise.reject(new Error("update failed"))
						: Promise.resolve();
				},
			}),
		}),
	};

	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		db: db as any,
		updates,
		getWhere: () => whereCond,
		getOrderBy: () => orderByArg,
	};
}

function pruneHarness(deleted: { id: string }[]) {
	let whereCond: unknown;
	const db = {
		delete: () => ({
			where: (cond: unknown) => {
				whereCond = cond;
				return { returning: () => Promise.resolve(deleted) };
			},
		}),
	};
	return {
		// biome-ignore lint/suspicious/noExplicitAny: hand-rolled fake stands in for the drizzle db.
		db: db as any,
		getWhere: () => whereCond,
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

afterEach(() => vi.restoreAllMocks());

describe("runSweep", () => {
	it("delivers each due row with id = the outbox row id, then marks it processed", async () => {
		const rows = [row("r1"), row("r2")];
		const h = sweepHarness(rows);
		const sends: { id: string; name: string; data: unknown }[] = [];
		const runSweep = makeRunSweep({
			db: h.db,
			deliver: async (e) => {
				sends.push(e);
			},
		});

		const result = await runSweep();

		expect(result).toEqual({ delivered: 2, failed: 0 });
		expect(sends).toEqual([
			{ id: "r1", name: "receipt/uploaded", data: { receiptId: "r1" } },
			{ id: "r2", name: "receipt/uploaded", data: { receiptId: "r2" } },
		]);
		// Only the wire fields cross to Inngest — internal columns
		// (attempts/processedAt/lastError) must never ride along.
		for (const sent of sends) {
			expect(Object.keys(sent).sort()).toEqual(["data", "id", "name"]);
		}
		expect(h.updates).toHaveLength(2);
		expect(h.updates[0]?.processedAt).toBeInstanceOf(Date);
		expect(h.updates[1]?.processedAt).toBeInstanceOf(Date);
	});

	it("only queries unacked rows past the 30s floor, oldest first", async () => {
		const h = sweepHarness([]);
		const runSweep = makeRunSweep({ db: h.db, deliver: async () => {} });

		await runSweep();

		const where = render(h.getWhere());
		expect(where).toContain("is null");
		expect(where).toContain("30 seconds");
		expect(h.getOrderBy()).toBe(outbox.createdAt);
	});

	it("swallows a failing delivery: bumps attempts + lastError and leaves the row unacked", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = sweepHarness([row("r1")]);
		const runSweep = makeRunSweep({
			db: h.db,
			deliver: async () => {
				throw new Error("boom");
			},
		});

		const result = await runSweep();

		expect(result).toEqual({ delivered: 0, failed: 1 });
		expect(h.updates).toHaveLength(1);
		expect(h.updates[0]).toHaveProperty("attempts");
		expect(h.updates[0]?.lastError).toBe("boom");
		expect(h.updates[0]).not.toHaveProperty("processedAt");
	});

	// A throw in the post-delivery ack must never escape the sweep — else one stuck row
	// aborts the whole run and starves every later row behind it.
	it("swallows a failing ack update: delivery succeeds, the processedAt write throws, sweep still resolves", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const h = sweepHarness([row("r1")], { updateThrows: true });
		const runSweep = makeRunSweep({ db: h.db, deliver: async () => {} });

		await expect(runSweep()).resolves.toEqual({ delivered: 1, failed: 0 });
		expect(console.error).toHaveBeenCalled();
	});
});

describe("runPrune", () => {
	it("deletes acked rows past the retention window and returns the count", async () => {
		const h = pruneHarness([{ id: "a" }, { id: "b" }]);
		const runPrune = makeRunPrune({ db: h.db });

		const result = await runPrune();

		expect(result).toEqual({ deleted: 2 });
	});

	it("targets only rows processed over 7 days ago — never unacked/stuck rows", async () => {
		const h = pruneHarness([]);
		const runPrune = makeRunPrune({ db: h.db });

		await runPrune();

		const where = render(h.getWhere());
		expect(where).toContain("processedAt");
		expect(where).toContain("7 days");
		// `processed_at < …` is NULL-false, so unacked rows can't match — no `is null` branch.
		expect(where).not.toContain("is null");
	});
});
