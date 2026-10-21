import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { BalanceSource } from "~/lib/constants";

export const balanceSource = pgEnum(
	"balance_source",
	Object.values(BalanceSource) as [BalanceSource, ...BalanceSource[]],
);

// One household-wide balance per row, append-only. The latest by asOf (tiebreak
// id desc) anchors the cash flow projection (design decision 5). No updatedAt —
// snapshots are never edited; "update balance" records a new row.
export const balanceSnapshots = pgTable("balance_snapshot", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	amount: d.doublePrecision().notNull(),
	asOf: d.timestamp({ withTimezone: true }).notNull(),
	source: balanceSource().notNull().default(BalanceSource.Manual),
	createdAt: d
		.timestamp({ withTimezone: true })
		.$defaultFn(() => new Date())
		.notNull(),
}));
