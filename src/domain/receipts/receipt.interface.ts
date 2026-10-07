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
	// The ingest trace id (adr016/adr020); null when OTel unregistered at creation.
	traceId: string | null;
	transactionId: number | null;
	duplicateOfId: number | null;
	createdAt: Date;
	updatedAt: Date | null;
}

// The vocabulary the extractor maps each line item to: the household's categories
// by id, so the model prefills `categoryId` from this list or returns null.
export interface ExtractionCategory {
	id: number;
	name: string;
}

export interface ReceiptItem {
	id: number;
	receiptId: number;
	name: string;
	price: number;
	quantity: number;
	expenseId: number | null;
	categoryId: number | null;
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
	categoryName: string | null;
}

// One receipt with its line items — the detail overlay's payload. The description
// names the confirmed match, so the banner can say what it linked to after reload.
export interface ReceiptDetail extends Receipt {
	transactionDescription: string | null;
	// Server-built PostHog trace-viewer link; null when no project id or trace id.
	traceUrl: string | null;
	items: ReceiptItemDetail[];
}
