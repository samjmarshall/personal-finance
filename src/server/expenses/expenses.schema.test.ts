import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { expenses } from "./expenses.schema";

const cols = getTableColumns(expenses);

describe("expense insert defaults", () => {
	it("defaults the fortnight, month and year amounts to 0", () => {
		expect(cols.fortnight.default).toBe(0);
		expect(cols.month.default).toBe(0);
		expect(cols.year.default).toBe(0);
	});

	it("defaults sortOrder to 0", () => {
		expect(cols.sortOrder.default).toBe(0);
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});

	it("leaves name and category for the caller to supply", () => {
		expect(cols.name.hasDefault).toBe(false);
		expect(cols.category.hasDefault).toBe(false);
	});
});
