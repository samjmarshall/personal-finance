import { index, pgTable } from "drizzle-orm/pg-core";

export const transactions = pgTable(
	"transaction",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		date: d.timestamp({ withTimezone: true }).notNull(),
		description: d.text().notNull(),
		receiptDescription: d.text(),
		amount: d.doublePrecision().notNull().default(0),
		category: d.text().notNull().default("Uncategorised"),
		frequency: d.text().notNull().default("One-off"),
		priority: d.text().notNull().default("Nice to Have"),
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
	],
);
