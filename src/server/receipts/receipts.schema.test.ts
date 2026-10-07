import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { receiptItems, receipts } from "./receipts.schema";

const receiptCols = getTableColumns(receipts);
const itemCols = getTableColumns(receiptItems);

describe("receipt table shape", () => {
	it("requires the blob coordinates the worker fetches from", () => {
		expect(receiptCols.blobUrl.notNull).toBe(true);
		expect(receiptCols.blobPathname.notNull).toBe(true);
	});

	// Deleting a member's auth row must never wipe their receipts — tax evidence is
	// kept forever (schema uses onDelete: set null; userId goes null, the row stays).
	it("keeps the receipt when its owner is deleted (userId nullable)", () => {
		expect(receiptCols.userId.notNull).toBe(false);
	});

	it("defaults status to pending and channel to upload on upload", () => {
		expect(receiptCols.status.hasDefault).toBe(true);
		expect(receiptCols.status.default).toBe(ReceiptStatus.Pending);
		expect(receiptCols.channel.hasDefault).toBe(true);
		expect(receiptCols.channel.default).toBe(ReceiptChannel.Upload);
	});

	// Everything the worker extracts is null until it runs.
	it("leaves extracted fields nullable without a default", () => {
		for (const col of [
			receiptCols.vendor,
			receiptCols.receiptDate,
			receiptCols.total,
			receiptCols.currency,
			receiptCols.contentHash,
			receiptCols.rawJson,
			receiptCols.error,
			receiptCols.transactionId,
			receiptCols.duplicateOfId,
		]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});

	// String mode keeps the calendar date as YYYY-MM-DD across the wire.
	it("stores receiptDate as a string", () => {
		expect(receiptCols.receiptDate.dataType).toBe("string");
	});

	it("makes id the identity primary key", () => {
		expect(receiptCols.id.primary).toBe(true);
	});
});

describe("receipt_item table shape", () => {
	it("requires its parent receipt, name, and price", () => {
		expect(itemCols.receiptId.notNull).toBe(true);
		expect(itemCols.name.notNull).toBe(true);
		expect(itemCols.price.notNull).toBe(true);
	});

	it("defaults quantity to 1", () => {
		expect(itemCols.quantity.hasDefault).toBe(true);
		expect(itemCols.quantity.default).toBe(1);
	});

	// Attribution is filled by the member on the detail page; null until then.
	it("leaves the expense/category links nullable without a default", () => {
		for (const col of [itemCols.expenseId, itemCols.categoryId]) {
			expect(col.notNull).toBe(false);
			expect(col.hasDefault).toBe(false);
		}
	});
});
