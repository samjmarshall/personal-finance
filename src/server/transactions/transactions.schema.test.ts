import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { Frequency, Priority, Provenance } from "~/lib/constants";
import { transactions } from "./transactions.schema";

const cols = getTableColumns(transactions);

describe("transaction insert defaults", () => {
	it("defaults an untagged group to Uncategorised", () => {
		expect(cols.group.default).toBe("Uncategorised");
	});

	it("defaults frequency to one-off", () => {
		expect(cols.frequency.default).toBe(Frequency.OneOff);
	});

	it("defaults priority to nice-to-have", () => {
		expect(cols.priority.default).toBe(Priority.NiceToHave);
	});

	it("stamps createdAt with the current date", () => {
		expect(cols.createdAt.defaultFn?.()).toBeInstanceOf(Date);
	});

	it("leaves date, description and amount for the caller to supply", () => {
		expect(cols.date.hasDefault).toBe(false);
		expect(cols.description.hasDefault).toBe(false);
		expect(cols.amount.hasDefault).toBe(false);
	});

	it("stamps a member-created row as manual provenance", () => {
		expect(cols.provenance.default).toBe(Provenance.Manual);
		expect(cols.provenance.notNull).toBe(true);
	});

	it("leaves externalId and accountName empty for a manual row", () => {
		expect(cols.externalId.notNull).toBe(false);
		expect(cols.externalId.hasDefault).toBe(false);
		expect(cols.accountName.notNull).toBe(false);
		expect(cols.accountName.hasDefault).toBe(false);
	});
});

describe("transaction constraints", () => {
	// adr025: a linked Transaction takes its Category from the Expense.
	it("refuses a row with both an expenseId and its own categoryId", () => {
		const names = getTableConfig(transactions).checks.map((c) => c.name);

		expect(names).toEqual(["transaction_expense_or_category_check"]);
	});

	// adr017: many manual rows have no externalId; a synced row is unique per provenance.
	it("dedups synced rows on (provenance, externalId) only when externalId is set", () => {
		const index = getTableConfig(transactions).indexes.find(
			(i) => i.config.name === "transaction_provenance_external_idx",
		);

		expect(index?.config.unique).toBe(true);
		expect(
			index?.config.columns.map((c) => ("name" in c ? c.name : undefined)),
		).toEqual(["provenance", "externalId"]);
		expect(index?.config.where).toBeDefined();
	});
});
