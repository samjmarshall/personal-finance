import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CdrImport, CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus, CdrImportStatus } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { unstaged } from "~/test/fakes";
import { DrizzleCdrRepository } from "./cdr.repository";
import { cdrImport, cdrSyncState } from "./cdr.schema";

// Stand-in write door: runs the writes in the test db's transaction and keeps the
// events, so the SQL lands in the snapshot. outbox.service.test.ts covers the real one.
function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	const events: OutboxEventDescriptor[] = [];
	const outbox: OutboxWriteDoor = {
		commit: (writes, toEvents) =>
			db.transaction(async (tx) => {
				const result = await writes(tx as never);
				events.push(...toEvents(result));
				return result;
			}),
		publish: unstaged,
	};
	return {
		repository: new DrizzleCdrRepository({ db: db as never, outbox }),
		queries,
		events,
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

const IMPORT_COLUMNS = Object.keys(getTableColumns(cdrImport));

const IMPORT = {
	id: 7,
	fromDate: new Date("2026-01-01T00:00:00.000Z"),
	toDate: new Date("2026-03-31T00:00:00.000Z"),
	status: CdrImportStatus.Queued,
	added: 0,
	adopted: 0,
	flagged: 0,
	known: 0,
	error: null,
	createdAt: NOW,
	finishedAt: null,
} satisfies CdrImport;

describe("insertImport", () => {
	it("inserts the row in a transaction and returns it", async () => {
		const { repository, queries } = harness(() => [
			rowOf(IMPORT_COLUMNS, IMPORT),
		]);

		await expect(
			repository.insertImport({
				fromDate: IMPORT.fromDate,
				toDate: IMPORT.toDate,
			}),
		).resolves.toEqual(IMPORT);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "begin",
			  },
			  {
			    "method": "all",
			    "params": [
			      "2026-01-01T00:00:00.000Z",
			      "2026-03-31T00:00:00.000Z",
			    ],
			    "sql": "insert into "cdr_import" ("id", "fromDate", "toDate", "status", "added", "adopted", "flagged", "known", "error", "createdAt", "finishedAt") values (default, $1, $2, default, default, default, default, default, default, default, default) returning "id", "fromDate", "toDate", "status", "added", "adopted", "flagged", "known", "error", "createdAt", "finishedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	// The event needs the new id, so the row and its event commit together.
	it("commits one cdr/import.requested event carrying the new id", async () => {
		const { repository, events } = harness(() => [
			rowOf(IMPORT_COLUMNS, IMPORT),
		]);

		await repository.insertImport({
			fromDate: IMPORT.fromDate,
			toDate: IMPORT.toDate,
		});

		expect(events.map(({ name, data }) => [name, data])).toEqual([
			["cdr/import.requested", { importId: 7, _trace: expect.any(Object) }],
		]);
	});
});

describe("findActiveImport", () => {
	it("finds a queued or running import created after the cut-off", async () => {
		const { repository, queries } = harness(() => []);

		await expect(
			repository.findActiveImport(new Date("2026-10-18T00:00:00.000Z")),
		).resolves.toBeUndefined();
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "queued",
			      "running",
			      "2026-10-18T00:00:00.000Z",
			      1,
			    ],
			    "sql": "select "id", "fromDate", "toDate", "status", "added", "adopted", "flagged", "known", "error", "createdAt", "finishedAt" from "cdr_import" where ("cdr_import"."status" in ($1, $2) and "cdr_import"."createdAt" > $3) limit $4",
			  },
			]
		`);
	});
});

describe("latestImport", () => {
	it("reads the newest import", async () => {
		const { repository, queries } = harness(() => [
			rowOf(IMPORT_COLUMNS, IMPORT),
		]);

		await expect(repository.latestImport()).resolves.toEqual(IMPORT);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			    ],
			    "sql": "select "id", "fromDate", "toDate", "status", "added", "adopted", "flagged", "known", "error", "createdAt", "finishedAt" from "cdr_import" order by "cdr_import"."id" desc limit $1",
			  },
			]
		`);
	});
});

describe("markImportRunning", () => {
	// The outbox can deliver the event again past Inngest's dedup window.
	it("moves only a queued import and returns it", async () => {
		const running = { ...IMPORT, status: CdrImportStatus.Running };
		const { repository, queries } = harness(() => [
			rowOf(IMPORT_COLUMNS, running),
		]);

		await expect(repository.markImportRunning(7)).resolves.toEqual(running);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "running",
			      7,
			      "queued",
			    ],
			    "sql": "update "cdr_import" set "status" = $1 where ("cdr_import"."id" = $2 and "cdr_import"."status" = $3) returning "id", "fromDate", "toDate", "status", "added", "adopted", "flagged", "known", "error", "createdAt", "finishedAt"",
			  },
			]
		`);
	});

	it("returns undefined when the import is past queued", async () => {
		const { repository } = harness(() => []);

		await expect(repository.markImportRunning(7)).resolves.toBeUndefined();
	});
});

describe("addImportCounts", () => {
	it("adds each count to the saved total", async () => {
		const { repository, queries } = harness();

		await repository.addImportCounts(7, {
			added: 2,
			adopted: 3,
			flagged: 1,
			known: 40,
		});

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      2,
			      3,
			      1,
			      40,
			      7,
			    ],
			    "sql": "update "cdr_import" set "added" = "cdr_import"."added" + $1, "adopted" = "cdr_import"."adopted" + $2, "flagged" = "cdr_import"."flagged" + $3, "known" = "cdr_import"."known" + $4 where "cdr_import"."id" = $5",
			  },
			]
		`);
	});
});

describe("finishImport", () => {
	// A run planImport already failed must not turn back into done.
	it("moves only a running import to done", async () => {
		const { repository, queries } = harness();

		await repository.finishImport(7);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "done",
			      "2026-10-19T00:00:00.000Z",
			      7,
			      "running",
			    ],
			    "sql": "update "cdr_import" set "status" = $1, "finishedAt" = $2 where ("cdr_import"."id" = $3 and "cdr_import"."status" = $4)",
			  },
			]
		`);
	});
});

describe("failImport", () => {
	// A done import stays done; a failed one keeps its first reason.
	it("fails only a queued or running import, with the reason", async () => {
		const { repository, queries } = harness();

		await repository.failImport(7, "Bank sync isn't set up");

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "failed",
			      "Bank sync isn't set up",
			      "2026-10-19T00:00:00.000Z",
			      7,
			      "queued",
			      "running",
			    ],
			    "sql": "update "cdr_import" set "status" = $1, "error" = $2, "finishedAt" = $3 where ("cdr_import"."id" = $4 and "cdr_import"."status" in ($5, $6))",
			  },
			]
		`);
	});
});
