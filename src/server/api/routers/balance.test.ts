import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { DrizzleBalancesRepository } from "~/server/balances/balances.repository";
import { balanceSnapshots } from "~/server/balances/balances.schema";
import { BalancesService } from "~/server/balances/balances.service";
import { balanceRouter } from "~/server/balances/balances.trpc.controller";
import { type Respond, recordingDb } from "~/server/db/recording-db.fake";

// Characterizes the router before it moves to src/server/balances/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ balance: balanceRouter });

function harness(
	respond?: Respond,
	session: { user: { id: string } } | null = { user: { id: "member-1" } },
) {
	const { db, queries } = recordingDb(respond);
	const service = new BalancesService({
		repository: new DrizzleBalancesRepository({ db: db as never }),
	});
	const caller = createTestCaller(router, {
		services: { balances: service },
		session,
	});
	return { balance: caller.balance, queries };
}

// Pins the $defaultFn timestamp drizzle adds to writes.
const NOW = new Date("2026-10-06T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(balanceSnapshots));

// Driver sends timestamps as text; drizzle parses them back into Dates.
function rowOf(fields: string[], fixture: Record<string, unknown>) {
	return fields.map((field) => {
		const value = fixture[field];
		return value instanceof Date ? value.toISOString() : (value ?? null);
	});
}

const SNAPSHOT = {
	id: 7,
	amount: 12500.5,
	asOf: new Date("2026-10-01T00:00:00.000Z"),
	createdAt: new Date("2026-10-01T01:00:00.000Z"),
} satisfies BalanceSnapshot;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("latest", () => {
	it("selects the newest snapshot, then the highest id", async () => {
		const { balance, queries } = harness(() => [rowOf(COLUMNS, SNAPSHOT)]);

		await expect(balance.latest()).resolves.toEqual(SNAPSHOT);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			    ],
			    "sql": "select "id", "amount", "asOf", "createdAt" from "balance_snapshot" order by "balance_snapshot"."asOf" desc, "balance_snapshot"."id" desc limit $1",
			  },
			]
		`);
	});

	it("gives null when there are no snapshots", async () => {
		const { balance } = harness();

		await expect(balance.latest()).resolves.toBeNull();
	});
});

describe("set", () => {
	const INPUT = { amount: 12500.5, asOf: SNAPSHOT.asOf };

	it("appends a snapshot and returns the stored row", async () => {
		const { balance, queries } = harness(() => [rowOf(COLUMNS, SNAPSHOT)]);

		await expect(balance.set(INPUT)).resolves.toEqual(SNAPSHOT);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      12500.5,
			      "2026-10-01T00:00:00.000Z",
			      "2026-10-06T00:00:00.000Z",
			    ],
			    "sql": "insert into "balance_snapshot" ("id", "amount", "asOf", "createdAt") values (default, $1, $2, $3) returning "id", "amount", "asOf", "createdAt"",
			  },
			]
		`);
	});

	it("fails as a 500 when the insert returns no row", async () => {
		const { balance } = harness();

		await expect(balance.set(INPUT)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to set balance.",
		});
	});
});

describe("signed out", () => {
	it.each([
		["latest", (b: ReturnType<typeof harness>["balance"]) => b.latest()],
		[
			"set",
			(b: ReturnType<typeof harness>["balance"]) =>
				b.set({ amount: 1, asOf: SNAPSHOT.asOf }),
		],
	])("rejects %s before any query", async (_name, call) => {
		const { balance, queries } = harness(undefined, null);

		await expect(call(balance)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(queries).toEqual([]);
	});
});
