import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleCdrRepository } from "./cdr.repository";
import { cdrSyncState } from "./cdr.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleCdrRepository({ db: db as never }),
		queries,
	};
}

const NOW = new Date("2026-10-19T00:00:00.000Z");
const COLUMNS = Object.keys(getTableColumns(cdrSyncState));

const SYNC_STATE = {
	id: 1,
	accountId: "acc_1",
	accountName: "Everyday",
	accountNumber: "xxxx8273",
	balance: 5489.69,
	balanceAsOf: new Date("2026-10-18T18:00:00.000Z"),
	connectionId: "conn_1",
	connectionStatus: CdrConnectionStatus.Active,
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	highWaterMark: new Date("2026-10-15T00:00:00.000Z"),
	inBalance: true,
	institutionName: "CommBank",
	lastError: null,
	lastSyncedAt: new Date("2026-10-18T18:00:00.000Z"),
	nickname: null,
	updatedAt: null,
} satisfies CdrSyncState;

const DISCOVERED = {
	accountId: "acc_1",
	connectionId: "conn_1",
	accountName: "Everyday",
	institutionName: "CommBank",
	accountNumber: "xxxx8273",
	connectionStatus: CdrConnectionStatus.Active,
	inBalance: true,
};

// Freeze Date only, so the auto update time stays stable.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => {
	vi.useRealTimers();
});

describe("listSyncState", () => {
	it("reads every account's row in id order", async () => {
		const { repository, queries } = harness(() => [rowOf(COLUMNS, SYNC_STATE)]);

		await expect(repository.listSyncState()).resolves.toEqual([SYNC_STATE]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "accountId", "connectionId", "accountName", "institutionName", "accountNumber", "balance", "balanceAsOf", "nickname", "highWaterMark", "connectionStatus", "lastSyncedAt", "lastError", "inBalance", "createdAt", "updatedAt" from "cdr_sync_state" order by "cdr_sync_state"."id" asc",
			  },
			]
		`);
	});
});

describe("findSyncState", () => {
	it("reads one account's row by its RedBark id", async () => {
		const { repository, queries } = harness(() => [rowOf(COLUMNS, SYNC_STATE)]);

		await expect(repository.findSyncState("acc_1")).resolves.toEqual(
			SYNC_STATE,
		);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "acc_1",
			    ],
			    "sql": "select "id", "accountId", "connectionId", "accountName", "institutionName", "accountNumber", "balance", "balanceAsOf", "nickname", "highWaterMark", "connectionStatus", "lastSyncedAt", "lastError", "inBalance", "createdAt", "updatedAt" from "cdr_sync_state" where "cdr_sync_state"."accountId" = $1",
			  },
			]
		`);
	});

	it("gives undefined when no row has the account id", async () => {
		const { repository } = harness();

		await expect(repository.findSyncState("acc_x")).resolves.toBeUndefined();
	});
});

describe("upsertAccount", () => {
	// coalesce: discovery fills inBalance once, then a member's choice stays.
	it("inserts or refreshes the account on accountId, leaving highWaterMark and a set inBalance alone", async () => {
		const { repository, queries } = harness();

		await repository.upsertAccount(DISCOVERED);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "acc_1",
			      "conn_1",
			      "Everyday",
			      "CommBank",
			      "xxxx8273",
			      "active",
			      true,
			      "2026-10-19T00:00:00.000Z",
			      "conn_1",
			      "Everyday",
			      "CommBank",
			      "xxxx8273",
			      "active",
			      "2026-10-19T00:00:00.000Z",
			    ],
			    "sql": "insert into "cdr_sync_state" ("id", "accountId", "connectionId", "accountName", "institutionName", "accountNumber", "balance", "balanceAsOf", "nickname", "highWaterMark", "connectionStatus", "lastSyncedAt", "lastError", "inBalance", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, $5, default, default, default, default, $6, default, default, $7, default, $8) on conflict ("accountId") do update set "connectionId" = $9, "accountName" = $10, "institutionName" = $11, "accountNumber" = $12, "connectionStatus" = $13, "inBalance" = coalesce("cdr_sync_state"."inBalance", excluded."inBalance"), "updatedAt" = $14",
			  },
			]
		`);
	});

	// The member owns the nickname; a sync renaming it back would undo their edit.
	it("never writes the nickname", async () => {
		const { repository, queries } = harness();

		await repository.upsertAccount(DISCOVERED);

		const [, update] = queries[0]?.sql.split(" do update set ") ?? [];
		expect(update).toBeDefined();
		expect(update).not.toContain('"nickname"');
	});

	it("lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23502"));

		await expect(
			repository.upsertAccount({ ...DISCOVERED, inBalance: null }),
		).rejects.toMatchObject({ cause: { code: "23502" } });
	});
});

describe("advanceHighWaterMark", () => {
	it("keeps the later of the saved and new mark, stamps the sync and clears the error", async () => {
		const { repository, queries } = harness();

		await repository.advanceHighWaterMark(
			"acc_1",
			new Date("2026-10-18T00:00:00.000Z"),
			NOW,
		);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-18T00:00:00.000Z",
			      "2026-10-19T00:00:00.000Z",
			      null,
			      "2026-10-19T00:00:00.000Z",
			      "acc_1",
			    ],
			    "sql": "update "cdr_sync_state" set "highWaterMark" = greatest("cdr_sync_state"."highWaterMark", $1), "lastSyncedAt" = $2, "lastError" = $3, "updatedAt" = $4 where "cdr_sync_state"."accountId" = $5",
			  },
			]
		`);
	});
});

describe("setConnectionStatus", () => {
	it("updates every account on the connection", async () => {
		const { repository, queries } = harness();

		await repository.setConnectionStatus("conn_1", CdrConnectionStatus.Revoked);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "revoked",
			      "2026-10-19T00:00:00.000Z",
			      "conn_1",
			    ],
			    "sql": "update "cdr_sync_state" set "connectionStatus" = $1, "updatedAt" = $2 where "cdr_sync_state"."connectionId" = $3",
			  },
			]
		`);
	});
});

describe("recordError", () => {
	it("saves the message on the account's row", async () => {
		const { repository, queries } = harness();

		await repository.recordError("acc_1", "not in RedBark");

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "not in RedBark",
			      "2026-10-19T00:00:00.000Z",
			      "acc_1",
			    ],
			    "sql": "update "cdr_sync_state" set "lastError" = $1, "updatedAt" = $2 where "cdr_sync_state"."accountId" = $3",
			  },
			]
		`);
	});
});

describe("setInBalance", () => {
	it("saves one account's choice and returns its row", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, { ...SYNC_STATE, inBalance: false, updatedAt: NOW }),
		]);

		await expect(repository.setInBalance("acc_1", false)).resolves.toEqual({
			...SYNC_STATE,
			inBalance: false,
			updatedAt: NOW,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      false,
			      "2026-10-19T00:00:00.000Z",
			      "acc_1",
			    ],
			    "sql": "update "cdr_sync_state" set "inBalance" = $1, "updatedAt" = $2 where "cdr_sync_state"."accountId" = $3 returning "id", "accountId", "connectionId", "accountName", "institutionName", "accountNumber", "balance", "balanceAsOf", "nickname", "highWaterMark", "connectionStatus", "lastSyncedAt", "lastError", "inBalance", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("gives undefined when no row has the account id", async () => {
		const { repository } = harness();

		await expect(
			repository.setInBalance("acc_x", true),
		).resolves.toBeUndefined();
	});
});

describe("recordBalance", () => {
	it("saves one account's latest balance and when the bank read it", async () => {
		const { repository, queries } = harness();

		await repository.recordBalance("acc_1", {
			amount: -8394.25,
			asOf: new Date("2026-10-18T18:00:00.000Z"),
		});

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      -8394.25,
			      "2026-10-18T18:00:00.000Z",
			      "2026-10-19T00:00:00.000Z",
			      "acc_1",
			    ],
			    "sql": "update "cdr_sync_state" set "balance" = $1, "balanceAsOf" = $2, "updatedAt" = $3 where "cdr_sync_state"."accountId" = $4",
			  },
			]
		`);
	});
});

describe("setNickname", () => {
	it("saves one account's nickname and returns its row", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, { ...SYNC_STATE, nickname: "Bills", updatedAt: NOW }),
		]);

		await expect(repository.setNickname("acc_1", "Bills")).resolves.toEqual({
			...SYNC_STATE,
			nickname: "Bills",
			updatedAt: NOW,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Bills",
			      "2026-10-19T00:00:00.000Z",
			      "acc_1",
			    ],
			    "sql": "update "cdr_sync_state" set "nickname" = $1, "updatedAt" = $2 where "cdr_sync_state"."accountId" = $3 returning "id", "accountId", "connectionId", "accountName", "institutionName", "accountNumber", "balance", "balanceAsOf", "nickname", "highWaterMark", "connectionStatus", "lastSyncedAt", "lastError", "inBalance", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("clears the nickname with null", async () => {
		const { repository, queries } = harness();

		await repository.setNickname("acc_1", null);

		expect(queries[0]?.params[0]).toBeNull();
	});

	it("gives undefined when no row has the account id", async () => {
		const { repository } = harness();

		await expect(
			repository.setNickname("acc_x", "Bills"),
		).resolves.toBeUndefined();
	});
});
