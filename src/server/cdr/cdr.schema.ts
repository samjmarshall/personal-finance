import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { CdrConnectionStatus } from "~/lib/constants";

export const cdrConnectionStatus = pgEnum(
	"cdr_connection_status",
	Object.values(CdrConnectionStatus) as [
		CdrConnectionStatus,
		...CdrConnectionStatus[],
	],
);

// adr017 facet 5: one row per RedBark account. The sync cursor only moves
// forward, and only after that account's rows are saved.
export const cdrSyncState = pgTable("cdr_sync_state", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	accountId: d.text().notNull().unique(),
	// Null on a seeded row until the first run finds its connection.
	connectionId: d.text(),
	accountName: d.text(),
	institutionName: d.text(),
	// Masked by RedBark to the last four digits.
	accountNumber: d.text(),
	// Dollars, like balance_snapshot.amount. Kept when a read comes back empty.
	balance: d.doublePrecision(),
	balanceAsOf: d.timestamp({ withTimezone: true }),
	// The member's name for the account. Discovery never writes it, so a sync can't undo a rename.
	nickname: d.text(),
	highWaterMark: d.timestamp({ withTimezone: true }),
	connectionStatus: cdrConnectionStatus()
		.notNull()
		.default(CdrConnectionStatus.Pending),
	lastSyncedAt: d.timestamp({ withTimezone: true }),
	lastError: d.text(),
	// Counts toward the balance anchor. Null until decided: a seeded row has no
	// type before its first discovery.
	inBalance: d.boolean(),
	// A DB default, not a JS one: the seed script inserts with raw SQL.
	createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
	updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));
