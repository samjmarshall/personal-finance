// The private-blob proxy route (src/app/api/receipts/[id]/image); the store can't
// be loaded directly, so every <img>/link goes through here.
export function receiptImageUrl(id: number): string {
	return `/api/receipts/${id}/image`;
}

// File types a member may send as a receipt, by upload or email attachment. One
// list so the two doors can't drift. The image proxy keeps its own, stricter list.
export const RECEIPT_FILE_TYPES = [
	"image/jpeg",
	"image/png",
	"application/pdf",
];

export function isReceiptFileType(type: string): boolean {
	return RECEIPT_FILE_TYPES.includes(type);
}
