import { pgTable } from "drizzle-orm/pg-core";

export const expenseCategories = pgTable("expense_category", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	name: d.text().notNull().unique(),
	description: d.text(),
	sortOrder: d.integer().notNull().default(0),
	createdAt: d
		.timestamp({ withTimezone: true })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));
