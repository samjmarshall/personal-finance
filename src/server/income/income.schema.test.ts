import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CommitmentKind } from "~/lib/constants";

import { income } from "./income.schema";

const cols = getTableColumns(income);

describe("income insert defaults", () => {
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

	it("leaves person and source for the caller to supply", () => {
		expect(cols.person.hasDefault).toBe(false);
		expect(cols.source.hasDefault).toBe(false);
	});
});
