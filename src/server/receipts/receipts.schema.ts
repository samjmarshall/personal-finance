import {
	type AnyPgColumn,
	index,
	pgEnum,
	pgTable,
	unique,
} from "drizzle-orm/pg-core";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { user } from "~/server/auth/auth.schema";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { expenses } from "~/server/expenses/expenses.schema";
import { transactions } from "~/server/transactions/transactions.schema";

export const receiptStatus = pgEnum(
	"receipt_status",
	Object.values(ReceiptStatus) as [ReceiptStatus, ...ReceiptStatus[]],
);
export const receiptChannel = pgEnum(
	"receipt_channel",
	Object.values(ReceiptChannel) as [ReceiptChannel, ...ReceiptChannel[]],
);

export const receipts = pgTable(
	"receipt",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		status: receiptStatus().notNull().default(ReceiptStatus.Pending),
		channel: receiptChannel().notNull().default(ReceiptChannel.Upload),
		// set null, not cascade: a receipt is tax evidence kept forever, so deleting a
		// member's auth row detaches ownership but never wipes the receipt or its items.
		userId: d.text().references(() => user.id, { onDelete: "set null" }),
		blobUrl: d.text().notNull(),
		blobPathname: d.text().notNull(),
		contentType: d.text(),
		contentHash: d.text(),
		vendor: d.text(),
		// Calendar date (no time): string mode so it crosses tRPC as YYYY-MM-DD and
		// never drifts a day for a behind-UTC client.
		receiptDate: d.date({ mode: "string" }),
		total: d.doublePrecision(),
		currency: d.text(),
		rawJson: d.jsonb(),
		error: d.text(),
		// The ingest trace id (adr016/adr020) behind the PostHog deep-link; null when
		// OTel is unregistered. No index — only ever read by receipt id.
		traceId: d.text(),
		transactionId: d
			.integer()
			.references(() => transactions.id, { onDelete: "set null" }),
		duplicateOfId: d
			.integer()
			.references((): AnyPgColumn => receipts.id, { onDelete: "set null" }),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [
		// One receipt per transaction. Nulls-distinct (PG default) lets unmatched
		// rows coexist; a blocked 2nd non-null match is the dup-photo catcher.
		unique("receipt_transaction_unique").on(t.transactionId),
		index("receipt_content_hash_idx").on(t.contentHash),
		index("receipt_status_idx").on(t.status),
		index("receipt_user_idx").on(t.userId),
	],
);

export const receiptItems = pgTable(
	"receipt_item",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		receiptId: d
			.integer()
			.notNull()
			.references(() => receipts.id, { onDelete: "cascade" }),
		name: d.text().notNull(),
		price: d.doublePrecision().notNull(),
		quantity: d.doublePrecision().notNull().default(1),
		expenseId: d
			.integer()
			.references(() => expenses.id, { onDelete: "set null" }),
		expenseCategoryId: d
			.integer()
			.references(() => expenseCategories.id, { onDelete: "set null" }),
		createdAt: d
			.timestamp({ withTimezone: true })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [index("receipt_item_receipt_idx").on(t.receiptId)],
);
