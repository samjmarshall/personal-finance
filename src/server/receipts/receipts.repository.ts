import { and, eq, ne } from "drizzle-orm";
import type { ExtractionCategory } from "~/domain/receipts";
import { ReceiptStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { categories } from "~/server/expenses/categories.schema";
import { receiptItems, receipts } from "./receipts.schema";

export type ReceiptRow = typeof receipts.$inferSelect;
/** What an extraction fills in; status is set by the repository. */
export type ExtractionValues = Pick<
	typeof receipts.$inferInsert,
	"vendor" | "receiptDate" | "total" | "currency" | "rawJson"
>;
/** One line item; `receiptId` is attached by the repository. */
export type ReceiptItemInsert = Omit<
	typeof receiptItems.$inferInsert,
	"receiptId"
>;

/**
 * Data tier for `receipt` + `receipt_item`. Pure storage: throws on a driver
 * failure, logs nothing. Status transitions are named, never passed in.
 */
export interface ReceiptsRepository {
	findById(id: number): Promise<ReceiptRow | undefined>;
	setContentHash(id: number, contentHash: string): Promise<void>;
	/** A *processed* receipt with the same bytes, other than `excludeId`. */
	findProcessedByHash(
		contentHash: string,
		excludeId: number,
	): Promise<{ id: number } | undefined>;
	/** status → duplicate, pointing at the original. */
	markDuplicate(id: number, duplicateOfId: number): Promise<void>;
	/** Sibling-domain read (server-architecture rule allows read joins). */
	listCategories(): Promise<ExtractionCategory[]>;
	/** status → processed + line items, in one transaction. */
	saveExtraction(
		id: number,
		values: ExtractionValues,
		items: ReceiptItemInsert[],
	): Promise<void>;
	/** status → failed with the member-facing reason. */
	markFailed(id: number, error: string): Promise<void>;
}

interface DrizzleReceiptsRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleReceiptsRepository implements ReceiptsRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleReceiptsRepositoryDeps) {
		this.db = db;
	}

	async findById(id: number): Promise<ReceiptRow | undefined> {
		const [receipt] = await this.db
			.select()
			.from(receipts)
			.where(eq(receipts.id, id));
		return receipt;
	}

	async setContentHash(id: number, contentHash: string): Promise<void> {
		await this.db
			.update(receipts)
			.set({ contentHash })
			.where(eq(receipts.id, id));
	}

	// Only a processed row can be the target — matching duplicates too would let a
	// third upload point at an empty duplicate row instead of the original.
	async findProcessedByHash(
		contentHash: string,
		excludeId: number,
	): Promise<{ id: number } | undefined> {
		const [dup] = await this.db
			.select({ id: receipts.id })
			.from(receipts)
			.where(
				and(
					eq(receipts.contentHash, contentHash),
					ne(receipts.id, excludeId),
					eq(receipts.status, ReceiptStatus.Processed),
				),
			);
		return dup;
	}

	async markDuplicate(id: number, duplicateOfId: number): Promise<void> {
		await this.db
			.update(receipts)
			.set({ status: ReceiptStatus.Duplicate, duplicateOfId })
			.where(eq(receipts.id, id));
	}

	async listCategories(): Promise<ExtractionCategory[]> {
		return this.db
			.select({ id: categories.id, name: categories.name })
			.from(categories);
	}

	async saveExtraction(
		id: number,
		values: ExtractionValues,
		items: ReceiptItemInsert[],
	): Promise<void> {
		await this.db.transaction(async (tx) => {
			await tx
				.update(receipts)
				.set({ status: ReceiptStatus.Processed, ...values })
				.where(eq(receipts.id, id));
			if (items.length > 0) {
				await tx
					.insert(receiptItems)
					.values(items.map((item) => ({ receiptId: id, ...item })));
			}
		});
	}

	async markFailed(id: number, error: string): Promise<void> {
		await this.db
			.update(receipts)
			.set({ status: ReceiptStatus.Failed, error })
			.where(eq(receipts.id, id));
	}
}
