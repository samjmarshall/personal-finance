import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CdrConnectionStatus } from "~/lib/constants";
import { cdrSyncState } from "./cdr.schema";

const cols = getTableColumns(cdrSyncState);

describe("cdr_sync_state table shape (adr017 facet 5)", () => {
	it("lives in the cdr_sync_state table", () => {
		expect(getTableName(cdrSyncState)).toBe("cdr_sync_state");
	});

	it("keeps one row per RedBark account", () => {
		expect(cols.accountId.notNull).toBe(true);
		expect(cols.accountId.isUnique).toBe(true);
	});

	it("defaults connectionStatus to pending", () => {
		expect(cols.connectionStatus.default).toBe(CdrConnectionStatus.Pending);
		expect(cols.connectionStatus.notNull).toBe(true);
	});

	// The seed script inserts with raw SQL, so this needs a DB default, not a JS one.
	it("stamps createdAt in the database", () => {
		expect(cols.createdAt.hasDefault).toBe(true);
		expect(cols.createdAt.defaultFn).toBeUndefined();
		expect(cols.createdAt.notNull).toBe(true);
	});

	// Null means a person hasn't decided yet: a seeded row has no type until discovery.
	it("leaves inBalance nullable with no default", () => {
		expect(cols.inBalance.notNull).toBe(false);
		expect(cols.inBalance.hasDefault).toBe(false);
	});

	it("leaves the sync fields nullable without a default", () => {
		for (const col of [
			cols.connectionId,
			cols.accountName,
			cols.highWaterMark,
			cols.lastSyncedAt,
			cols.lastError,
		]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});

	// Prototype D's list: a row saved before these columns has none until its next sync.
	it("leaves the list's account details nullable without a default", () => {
		for (const col of [
			cols.institutionName,
			cols.accountNumber,
			cols.balance,
			cols.balanceAsOf,
			cols.nickname,
		]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});
});
