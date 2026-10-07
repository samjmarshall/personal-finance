import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { Frequency, Priority } from "~/lib/constants";
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
		// adr025: a linked Transaction takes its Category from the Expense.
		check(
			"transaction_expense_or_category_check",
			sql`${t.expenseId} IS NULL OR ${t.categoryId} IS NULL`,
		),
	],
);
