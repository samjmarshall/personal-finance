import { pgTable } from "drizzle-orm/pg-core";

// Household-wide key/value settings (e.g. fortnightAnchor). Seeded by migration,
// managed from /settings; a missing row degrades gracefully rather than erroring.
export const appSettings = pgTable("app_setting", (d) => ({
	key: d.text().primaryKey(),
	value: d.text().notNull(),
}));
