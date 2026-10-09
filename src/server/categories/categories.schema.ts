import { pgTable } from "drizzle-orm/pg-core";

// The household's one shared list. A Category files Expenses, Transactions and
// receipt items, each linked by id.
export const categories = pgTable("category", (d) => ({
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
