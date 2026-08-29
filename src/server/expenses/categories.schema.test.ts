import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { expenseCategories } from "./categories.schema";

const cols = getTableColumns(expenseCategories);

describe("expense category insert defaults", () => {
	it("defaults sortOrder to 0", () => {
		expect(cols.sortOrder.default).toBe(0);
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});

	it("does not default name or description", () => {
		expect(cols.name.hasDefault).toBe(false);
		expect(cols.description.hasDefault).toBe(false);
	});
});
