import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgEnum,
	pgTable,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "~/domain/transactions";
import {
	Answer,
	DuplicateApplyStatus,
	Frequency,
	PossibleDuplicateStatus,
	Priority,
	Provenance,
} from "~/lib/constants";
import { categories } from "~/server/categories/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";

export const transactionFrequency = pgEnum(
	"transaction_frequency",
	Object.values(Frequency) as [Frequency, ...Frequency[]],
);
export const transactionPriority = pgEnum(
	"transaction_priority",
	Object.values(Priority) as [Priority, ...Priority[]],
);
export const transactionProvenance = pgEnum(
	"transaction_provenance",
	Object.values(Provenance) as [Provenance, ...Provenance[]],
);

export const transactions = pgTable(
	"transaction",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		// Deleting the Expense first copies its Category here (trigger, 0017).
		expenseId: d
			.integer()
			.references(() => expenses.id, { onDelete: "set null" }),
		categoryId: d
			.integer()
			.references(() => categories.id, { onDelete: "set null" }),
		date: d.timestamp({ withTimezone: true }).notNull(),
		description: d.text().notNull(),
		receiptDescription: d.text(),
		amount: d.doublePrecision().notNull(),
		group: d.text().notNull().default("Uncategorised"),
		frequency: transactionFrequency().notNull().default(Frequency.OneOff),
		priority: transactionPriority().notNull().default(Priority.NiceToHave),
		notes: d.text(),
		provenance: transactionProvenance().notNull().default(Provenance.Manual),
		// The provider's own id; null on a manual row.
		externalId: d.text(),
		externalAccountId: d.text(),
		accountName: d.text(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [
		index("transaction_date_idx").on(t.date),
		index("transaction_priority_idx").on(t.priority),
		index("transaction_expense_idx").on(t.expenseId),
		index("transaction_category_idx").on(t.categoryId),
		// adr017: re-sync updates its row, never duplicates. Partial, so manual
		// rows (no provider id) can repeat.
		uniqueIndex("transaction_provenance_external_idx")
			.on(t.provenance, t.externalId)
			.where(sql`${t.externalId} is not null`),
		// adr025: a linked Transaction takes its Category from the Expense.
		check(
			"transaction_expense_or_category_check",
			sql`${t.expenseId} IS NULL OR ${t.categoryId} IS NULL`,
		),
	],
);

export const possibleDuplicateStatus = pgEnum(
	"possible_duplicate_status",
	Object.values(PossibleDuplicateStatus) as [
		PossibleDuplicateStatus,
		...PossibleDuplicateStatus[],
	],
);

export const duplicateAnswer = pgEnum(
	"duplicate_answer",
	Object.values(Answer) as [Answer, ...Answer[]],
);
export const duplicateApplyStatus = pgEnum(
	"duplicate_apply_status",
	Object.values(DuplicateApplyStatus) as [
		DuplicateApplyStatus,
		...DuplicateApplyStatus[],
	],
);

// One Apply of a Member's Answers, run in the background (adr032).
export const duplicateApply = pgTable(
	"duplicate_apply",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		status: duplicateApplyStatus()
			.notNull()
			.default(DuplicateApplyStatus.Running),
		total: d.integer().notNull(),
		applied: d.integer().notNull().default(0),
		taken: d.integer().notNull().default(0),
		gone: d.integer().notNull().default(0),
		error: d.text(),
		createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
		// Every counter bump moves it, so a stale value means the job died.
		updatedAt: d
			.timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		finishedAt: d.timestamp({ withTimezone: true }),
	}),
	(t) => [
		// adr032: one Apply at a time.
		uniqueIndex("duplicate_apply_running_idx")
			.on(t.status)
			.where(sql`${t.status} = 'running'`),
	],
);

// A bank row that looks like a household row but isn't exact, held until a
// member answers. Nothing reaches `transaction` until then.
export const possibleDuplicates = pgTable(
	"possible_duplicate",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		// A backstop only: deleting the row first adds its held bank rows.
		transactionId: d
			.integer()
			.notNull()
			.references(() => transactions.id, { onDelete: "cascade" }),
		provenance: transactionProvenance()
			.$type<Exclude<Provenance, Provenance.Manual>>()
			.notNull(),
		externalId: d.text().notNull(),
		externalAccountId: d.text().notNull(),
		accountName: d.text().notNull(),
		amount: d.doublePrecision().notNull(),
		date: d.timestamp({ withTimezone: true }).notNull(),
		description: d.text().notNull(),
		// Merged score at flag time (adr029); null on reviews flagged before it.
		descriptionScore: d.doublePrecision(),
		status: possibleDuplicateStatus()
			.notNull()
			.default(PossibleDuplicateStatus.Pending),
		// Set while an Apply holds the Answer; a stamp on a listed row means that
		// Apply stopped (adr032).
		applyId: d
			.integer()
			.references(() => duplicateApply.id, { onDelete: "set null" }),
		answer: duplicateAnswer(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [
		uniqueIndex("possible_duplicate_external_idx").on(
			t.provenance,
			t.externalId,
		),
		index("possible_duplicate_transaction_idx").on(t.transactionId),
		index("possible_duplicate_apply_idx").on(t.applyId),
	],
);

// One meaning vector per cleaned description per model (adr029), so a description
// is embedded once, ever. Only looked up by exact text, so no vector index.
export const descriptionEmbeddings = pgTable(
	"description_embedding",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		model: d.text().notNull(),
		description: d.text().notNull(),
		embedding: d.vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
	}),
	(t) => [
		uniqueIndex("description_embedding_model_description_idx").on(
			t.model,
			t.description,
		),
	],
);
