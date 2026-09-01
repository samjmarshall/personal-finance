import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { balanceSnapshots } from "./balances.schema";

const cols = getTableColumns(balanceSnapshots);

describe("balance_snapshot columns", () => {
	// amount and asOf are the snapshot payload — the caller always supplies both.
	it("requires amount and asOf", () => {
		expect(cols.amount.notNull).toBe(true);
		expect(cols.asOf.notNull).toBe(true);
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.hasDefault).toBe(true);
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});
});
