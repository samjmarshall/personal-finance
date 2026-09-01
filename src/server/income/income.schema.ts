import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { CommitmentKind } from "~/lib/constants";

export const incomeKind = pgEnum(
	"income_kind",
	Object.values(CommitmentKind) as [CommitmentKind, ...CommitmentKind[]],
);

export const income = pgTable("income", (d) => ({
	id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
	person: d.text().notNull(),
	source: d.text().notNull(),
	kind: incomeKind().notNull().default(CommitmentKind.Recurring),
	fortnight: d.doublePrecision().notNull().default(0),
	month: d.doublePrecision().notNull().default(0),
	year: d.doublePrecision().notNull().default(0),
	// One-time figures (null for recurring): the fixed amount and the date it is
	// expected. dueDay/dueMonth are Timing for both kinds; the pickers arrive in
	// stage 3, the columns land now so the shape is fixed.
	amount: d.doublePrecision(),
	expectedDate: d.timestamp({ withTimezone: true }),
	dueDay: d.integer(),
	dueMonth: d.integer(),
	sortOrder: d.integer().notNull().default(0),
	createdAt: d
		.timestamp({ withTimezone: true })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));
