import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleBalancesRepository } from "./balances.repository";
import { balanceSnapshots } from "./balances.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleBalancesRepository({ db: db as never }),
		queries,
	};
}

// Pins the $defaultFn timestamp drizzle adds to writes.
const NOW = new Date("2026-10-06T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(balanceSnapshots));

const SNAPSHOT = {
	id: 7,
	amount: 12500.5,
	asOf: new Date("2026-10-01T00:00:00.000Z"),
	createdAt: new Date("2026-10-01T01:00:00.000Z"),
} satisfies BalanceSnapshot;

const SNAPSHOT_ROW = rowOf(COLUMNS, SNAPSHOT);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("DrizzleBalancesRepository", () => {
	it("findLatest selects the newest snapshot, then the highest id", async () => {
		const { repository, queries } = harness(() => [SNAPSHOT_ROW]);

		await expect(repository.findLatest()).resolves.toEqual(SNAPSHOT);
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

	it("findLatest gives undefined when there are no snapshots", async () => {
		const { repository } = harness();

		await expect(repository.findLatest()).resolves.toBeUndefined();
	});

	it("insert appends a snapshot and returns the stored row", async () => {
		const { repository, queries } = harness(() => [SNAPSHOT_ROW]);

		await expect(
			repository.insert({ amount: 12500.5, asOf: SNAPSHOT.asOf }),
		).resolves.toEqual(SNAPSHOT);
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

	it("insert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.insert({ amount: 1, asOf: SNAPSHOT.asOf }),
		).resolves.toBeUndefined();
	});

	it("insert lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23502"));

		await expect(
			repository.insert({ amount: 1, asOf: SNAPSHOT.asOf }),
		).rejects.toMatchObject({ cause: { code: "23502" } });
	});
});
