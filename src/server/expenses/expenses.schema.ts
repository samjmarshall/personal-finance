import { pgTable } from "drizzle-orm/pg-core";

export const expenses = pgTable("expense", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	name: d.text().notNull(),
	category: d.text().notNull(),
	fortnight: d.doublePrecision().notNull().default(0),
	month: d.doublePrecision().notNull().default(0),
	year: d.doublePrecision().notNull().default(0),
	sortOrder: d.integer().notNull().default(0),
	createdAt: d
		.timestamp({ withTimezone: true })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));
