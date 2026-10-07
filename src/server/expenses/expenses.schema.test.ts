import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { CommitmentKind } from "~/lib/constants";

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

	it("defaults kind to recurring", () => {
		expect(cols.kind.default).toBe(CommitmentKind.Recurring);
	});

	// One-time figures and Timing stay nullable with no default: a recurring row
	// leaves them null, and update's .set() must never fabricate a value.
	it("leaves the one-time and timing columns nullable without a default", () => {
		for (const col of [
			cols.amount,
			cols.expectedDate,
			cols.dueDay,
			cols.dueMonth,
		]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});

	it("leaves name and category for the caller to supply", () => {
		expect(cols.name.hasDefault).toBe(false);
		expect(cols.categoryId.hasDefault).toBe(false);
		expect(cols.categoryId.notNull).toBe(true);
	});

	// restrict: the database refuses to delete a Category while Expenses use it.
	it("links categoryId to category.id, restricting delete", () => {
		const [fk, ...rest] = getTableConfig(expenses).foreignKeys;
		const reference = fk?.reference();

		expect(rest).toEqual([]);
		expect(reference?.columns.map((c) => c.name)).toEqual(["categoryId"]);
		expect(reference && getTableName(reference.foreignTable)).toBe("category");
		expect(reference?.foreignColumns.map((c) => c.name)).toEqual(["id"]);
		expect(fk?.onDelete).toBe("restrict");
	});
});
