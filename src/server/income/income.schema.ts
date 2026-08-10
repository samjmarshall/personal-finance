import { pgTable } from "drizzle-orm/pg-core";

export const income = pgTable("income", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	person: d.text().notNull(),
	source: d.text().notNull(),
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
