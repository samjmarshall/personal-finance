import type { ReceiptChannel, ReceiptStatus } from "~/lib/constants";

export interface Receipt {
	id: number;
	status: ReceiptStatus;
	channel: ReceiptChannel;
	userId: string;
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
