import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgEnum,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { Frequency, Priority, Provenance } from "~/lib/constants";
import { categories } from "~/server/categories/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";

export const transactionFrequency = pgEnum(
	"transaction_frequency",
	Object.values(Frequency) as [Frequency, ...Frequency[]],
);
export const transactionPriority = pgEnum(
	"transaction_priority",
	Object.values(Priority) as [Priority, ...Priority[]],
);
export const transactionProvenance = pgEnum(
	"transaction_provenance",
	Object.values(Provenance) as [Provenance, ...Provenance[]],
);

export const transactions = pgTable(
	"transaction",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		// Deleting the Expense first copies its Category here (trigger, 0017).
		expenseId: d
			.integer()
			.references(() => expenses.id, { onDelete: "set null" }),
		categoryId: d
			.integer()
			.references(() => categories.id, { onDelete: "set null" }),
		date: d.timestamp({ withTimezone: true }).notNull(),
		description: d.text().notNull(),
		receiptDescription: d.text(),
		amount: d.doublePrecision().notNull(),
		group: d.text().notNull().default("Uncategorised"),
		frequency: transactionFrequency().notNull().default(Frequency.OneOff),
		priority: transactionPriority().notNull().default(Priority.NiceToHave),
		notes: d.text(),
		provenance: transactionProvenance().notNull().default(Provenance.Manual),
		// The provider's own id; null on a manual row.
		externalId: d.text(),
		accountName: d.text(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [
		index("transaction_date_idx").on(t.date),
		index("transaction_priority_idx").on(t.priority),
		index("transaction_expense_idx").on(t.expenseId),
		index("transaction_category_idx").on(t.categoryId),
		// adr017: re-sync updates its row, never duplicates. Partial, so manual
		// rows (no provider id) can repeat.
		uniqueIndex("transaction_provenance_external_idx")
			.on(t.provenance, t.externalId)
			.where(sql`${t.externalId} is not null`),
		// adr025: a linked Transaction takes its Category from the Expense.
		check(
			"transaction_expense_or_category_check",
			sql`${t.expenseId} IS NULL OR ${t.categoryId} IS NULL`,
		),
	],
);
