import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { CommitmentKind } from "~/lib/constants";
import { categories } from "~/server/categories/categories.schema";

export const expenseKind = pgEnum(
	"expense_kind",
	Object.values(CommitmentKind) as [CommitmentKind, ...CommitmentKind[]],
);

export const expenses = pgTable(
	"expense",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		name: d.text().notNull(),
		categoryId: d
			.integer()
			.notNull()
			.references(() => categories.id, { onDelete: "restrict" }),
		kind: expenseKind().notNull().default(CommitmentKind.Recurring),
		fortnight: d.doublePrecision().notNull().default(0),
		month: d.doublePrecision().notNull().default(0),
		year: d.doublePrecision().notNull().default(0),
		// One-time figures (null for recurring): the fixed amount and the date it is
		// consumed against. dueDay/dueMonth are Timing for both kinds.
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
	}),
	(t) => [index("expense_category_idx").on(t.categoryId)],
);
