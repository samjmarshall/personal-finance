import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { CdrConnectionStatus } from "~/lib/constants";

export const cdrConnectionStatus = pgEnum(
	"cdr_connection_status",
	Object.values(CdrConnectionStatus) as [
		CdrConnectionStatus,
		...CdrConnectionStatus[],
	],
);

// adr017 facet 5: one row per RedBark account. highWaterMark is the sync
// cursor; it only moves forward, and only after that account's rows are saved.
export const cdrSyncState = pgTable("cdr_sync_state", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	accountId: d.text().notNull().unique(),
	// Null on a seeded row until the first run finds its connection.
	connectionId: d.text(),
	accountName: d.text(),
	highWaterMark: d.timestamp({ withTimezone: true }),
	connectionStatus: cdrConnectionStatus()
		.notNull()
		.default(CdrConnectionStatus.Pending),
	lastSyncedAt: d.timestamp({ withTimezone: true }),
	lastError: d.text(),
	// A DB default, not $defaultFn: the seed script inserts with raw SQL.
	createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));
