import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Receipt, ReceiptItem } from "~/domain/receipts";
import { ReceiptStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { buildOutboxEvent } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { receiptItems, receipts } from "./receipts.schema";

/** A row about to be minted; status is set by the repository. */
export type PendingReceipt = Pick<
	typeof receipts.$inferInsert,
	"userId" | "channel" | "blobUrl" | "blobPathname" | "contentType" | "traceId"
>;

/** Each unset arm matches every row. */
export interface ReceiptFilter {
	status?: ReceiptStatus;
	unmatchedOnly?: boolean;
}

export type ReceiptMatchInput = Pick<Receipt, "total" | "receiptDate">;

/** Why a delete wrote nothing, or the file left to clean up. */
export type ReceiptDeletion =
	| Pick<Receipt, "blobPathname">
	| "missing"
	| "has-duplicates";

/**
 * Data tier for the member-facing reads and writes of `receipt` + `receipt_item`.
 * Pure storage: throws on a driver failure, logs nothing.
 */
export interface ReceiptsRepository {
	/** One event per row, committed with the rows. `rows` must not be empty. */
	insertPending(
		rows: PendingReceipt[],
		event: "receipt/uploaded" | "receipt/email.received",
	): Promise<Receipt[]>;
	/** Newest first. */
	findAll(filter: ReceiptFilter): Promise<Receipt[]>;
	findById(id: number): Promise<Receipt | undefined>;
	/** In id order. */
	findItems(receiptId: number): Promise<ReceiptItem[]>;
	/** A failed row → pending, plus `receipt/retry`. Undefined, and no event, for any other row. */
	requeueFailed(
		id: number,
		traceId: string | null,
	): Promise<Receipt | undefined>;
	findBlobPathname(id: number): Promise<string | undefined>;
	deleteUnlessDuplicated(id: number): Promise<ReceiptDeletion>;
	findMatchInput(id: number): Promise<ReceiptMatchInput | undefined>;
	/** The subset of `transactionIds` some receipt already links to. */
	findMatchedTransactionIds(transactionIds: number[]): Promise<number[]>;
	setTransaction(
		id: number,
		transactionId: number,
	): Promise<Receipt | undefined>;
	setItemExpense(
		itemId: number,
		expenseId: number | null,
	): Promise<ReceiptItem | undefined>;
	setItemCategory(
		itemId: number,
		categoryId: number | null,
	): Promise<ReceiptItem | undefined>;
}

interface DrizzleReceiptsRepositoryDeps {
	db: typeof realDb;
	outbox: OutboxWriteDoor;
}

export class DrizzleReceiptsRepository implements ReceiptsRepository {
	private readonly db: typeof realDb;
	private readonly outbox: OutboxWriteDoor;

	constructor({ db, outbox }: DrizzleReceiptsRepositoryDeps) {
		this.db = db;
		this.outbox = outbox;
	}

	// The event carries the row id, known only after the insert, so row and event
	// commit together.
	insertPending(
		rows: PendingReceipt[],
		event: "receipt/uploaded" | "receipt/email.received",
	): Promise<Receipt[]> {
		return this.outbox.commit(
			(tx) =>
				tx
					.insert(receipts)
					.values(
						rows.map((row) => ({ ...row, status: ReceiptStatus.Pending })),
					)
					.returning(),
			(inserted) =>
				inserted.map((row) => buildOutboxEvent(event, { receiptId: row.id })),
		);
	}

	findAll({ status, unmatchedOnly }: ReceiptFilter): Promise<Receipt[]> {
		return this.db
			.select()
			.from(receipts)
			.where(
				// Unset filters drop out. None set means no WHERE.
				and(
					status ? eq(receipts.status, status) : undefined,
					unmatchedOnly ? isNull(receipts.transactionId) : undefined,
				),
			)
			.orderBy(desc(receipts.createdAt), desc(receipts.id));
	}

	async findById(id: number): Promise<Receipt | undefined> {
		const [receipt] = await this.db
			.select()
			.from(receipts)
			.where(eq(receipts.id, id));
		return receipt;
	}

	findItems(receiptId: number): Promise<ReceiptItem[]> {
		return this.db
			.select()
			.from(receiptItems)
			.where(eq(receiptItems.receiptId, receiptId))
			.orderBy(asc(receiptItems.id));
	}

	// Only failed rows match, so a processed receipt can't be re-run (and
	// re-billed). No match, no retry.
	requeueFailed(
		id: number,
		traceId: string | null,
	): Promise<Receipt | undefined> {
		return this.outbox.commit(
			async (tx) => {
				const [row] = await tx
					.update(receipts)
					// New run, new trace link. Clear the old error so a pending receipt
					// doesn't show it.
					.set({ status: ReceiptStatus.Pending, traceId, error: null })
					.where(
						and(eq(receipts.id, id), eq(receipts.status, ReceiptStatus.Failed)),
					)
					.returning();
				return row;
			},
			(row) =>
				row ? [buildOutboxEvent("receipt/retry", { receiptId: row.id })] : [],
		);
	}

	async findBlobPathname(id: number): Promise<string | undefined> {
		const [row] = await this.db
			.select({ blobPathname: receipts.blobPathname })
			.from(receipts)
			.where(eq(receipts.id, id));
		return row?.blobPathname;
	}

	// Deleting an original would orphan its copies: no data, and retry skips them.
	// Lock the row so a copy being marked waits.
	deleteUnlessDuplicated(id: number): Promise<ReceiptDeletion> {
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.select({ blobPathname: receipts.blobPathname })
				.from(receipts)
				.where(eq(receipts.id, id))
				.for("update");
			if (!row) return "missing";
			const [copy] = await tx
				.select({ id: receipts.id })
				.from(receipts)
				.where(eq(receipts.duplicateOfId, id))
				.limit(1);
			if (copy) return "has-duplicates";
			await tx.delete(receipts).where(eq(receipts.id, id));
			return row;
		});
	}

	async findMatchInput(id: number): Promise<ReceiptMatchInput | undefined> {
		const [row] = await this.db
			.select({ total: receipts.total, receiptDate: receipts.receiptDate })
			.from(receipts)
			.where(eq(receipts.id, id));
		return row;
	}

	async findMatchedTransactionIds(transactionIds: number[]): Promise<number[]> {
		if (!transactionIds.length) return [];
		const rows = await this.db
			.select({ transactionId: receipts.transactionId })
			.from(receipts)
			.where(inArray(receipts.transactionId, transactionIds));
		return rows.map((row) => row.transactionId).filter((id) => id !== null);
	}

	async setTransaction(
		id: number,
		transactionId: number,
	): Promise<Receipt | undefined> {
		const [row] = await this.db
			.update(receipts)
			.set({ transactionId })
			.where(eq(receipts.id, id))
			.returning();
		return row;
	}

	async setItemExpense(
		itemId: number,
		expenseId: number | null,
	): Promise<ReceiptItem | undefined> {
		const [row] = await this.db
			.update(receiptItems)
			.set({ expenseId })
			.where(eq(receiptItems.id, itemId))
			.returning();
		return row;
	}

	async setItemCategory(
		itemId: number,
		categoryId: number | null,
	): Promise<ReceiptItem | undefined> {
		const [row] = await this.db
			.update(receiptItems)
			.set({ categoryId })
			.where(eq(receiptItems.id, itemId))
			.returning();
		return row;
	}
}
