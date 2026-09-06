import type { ReceiptChannel, ReceiptStatus } from "~/lib/constants";

export interface Receipt {
	id: number;
	status: ReceiptStatus;
	channel: ReceiptChannel;
	userId: string | null;
	blobUrl: string;
	blobPathname: string;
	contentType: string | null;
	contentHash: string | null;
	vendor: string | null;
	// Calendar date as YYYY-MM-DD; null until the worker extracts it.
	receiptDate: string | null;
	total: number | null;
	currency: string | null;
	rawJson: unknown;
	error: string | null;
	transactionId: number | null;
	duplicateOfId: number | null;
	createdAt: Date;
	updatedAt: Date | null;
}

export interface ReceiptItem {
	id: number;
	receiptId: number;
	name: string;
	price: number;
	quantity: number;
	expenseId: number | null;
	expenseCategoryId: number | null;
	createdAt: Date;
	updatedAt: Date | null;
}

// A receipt as it appears in the history table: the row plus the joined member
// name and matched-transaction description (null when unowned/unmatched).
export interface ReceiptListItem extends Receipt {
	userName: string | null;
	transactionDescription: string | null;
}

// A line item carrying its resolved expense/category labels for the detail view.
export interface ReceiptItemDetail extends ReceiptItem {
	expenseName: string | null;
	expenseCategoryName: string | null;
}

// One receipt with its line items — the detail overlay's payload.
export interface ReceiptDetail extends Receipt {
	items: ReceiptItemDetail[];
}
