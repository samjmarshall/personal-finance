import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { BalanceSource } from "~/lib/constants";

import { balanceSnapshots } from "./balances.schema";

const cols = getTableColumns(balanceSnapshots);

describe("balance_snapshot columns", () => {
	it("requires amount and asOf", () => {
		expect(cols.amount.notNull).toBe(true);
		expect(cols.asOf.notNull).toBe(true);
	});

	it("labels a snapshot as typed by the member unless told otherwise", () => {
		expect(cols.source.notNull).toBe(true);
		expect(cols.source.default).toBe(BalanceSource.Manual);
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.hasDefault).toBe(true);
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});
});
