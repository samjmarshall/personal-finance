import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
	Frequency,
	PossibleDuplicateStatus,
	Priority,
	Provenance,
} from "~/lib/constants";
import { possibleDuplicates, transactions } from "./transactions.schema";

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
		expect(cols.externalAccountId.notNull).toBe(false);
		expect(cols.externalAccountId.hasDefault).toBe(false);
	});
});

describe("transaction constraints", () => {
	// adr025: a linked Transaction takes its Category from the Expense.
	it("refuses a row with both an expenseId and its own categoryId", () => {
		const names = getTableConfig(transactions).checks.map((c) => c.name);

		expect(names).toEqual(["transaction_expense_or_category_check"]);
	});

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

describe("possible_duplicate", () => {
	const config = getTableConfig(possibleDuplicates);

	it("starts every review pending", () => {
		expect(getTableColumns(possibleDuplicates).status.default).toBe(
			PossibleDuplicateStatus.Pending,
		);
	});

	it("asks about one bank row once, ever", () => {
		const index = config.indexes.find(
			(i) => i.config.name === "possible_duplicate_external_idx",
		);

		expect(index?.config.unique).toBe(true);
		expect(
			index?.config.columns.map((c) => ("name" in c ? c.name : undefined)),
		).toEqual(["provenance", "externalId"]);
		expect(index?.config.where).toBeUndefined();
	});

	it("goes when its household row goes", () => {
		const [fk] = config.foreignKeys;

		expect(config.foreignKeys).toHaveLength(1);
		expect(fk?.reference().foreignTable).toBe(transactions);
		expect(fk?.onDelete).toBe("cascade");
	});
});
