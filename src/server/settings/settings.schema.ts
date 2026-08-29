import { pgTable } from "drizzle-orm/pg-core";

// Household-wide key/value settings (e.g. fortnightAnchor). Set-once seed rows,
// no UI; a missing row degrades gracefully rather than erroring (design).
export const appSettings = pgTable("app_setting", (d) => ({
	key: d.text().primaryKey(),
	value: d.text().notNull(),
}));
