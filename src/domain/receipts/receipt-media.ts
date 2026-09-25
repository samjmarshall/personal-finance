import { bareMediaType } from "~/lib/utils";

// The private-blob proxy route (src/app/api/receipts/[id]/image); the store can't
// be loaded directly, so every <img>/link goes through here.
export function receiptImageUrl(id: number): string {
	return `/api/receipts/${id}/image`;
}

export type ReceiptMediaKind = "image" | "pdf" | "text";

// One table for every media type a receipt can hold, so no caller keeps its own list.
const MEDIA_KINDS: Readonly<Record<string, ReceiptMediaKind>> = {
	"image/jpeg": "image",
	"image/png": "image",
	"application/pdf": "pdf",
	"text/html": "text",
	"text/plain": "text",
};

/** Kind of a stored receipt; `null` for anything the pipeline can't read. Ignores header params. */
export function receiptMediaKind(
	contentType: string | null | undefined,
): ReceiptMediaKind | null {
	return MEDIA_KINDS[bareMediaType(contentType)] ?? null;
}

// Types a member may send, by upload or email: one list so the two can't drift.
// Text is only ever the email body, never a file. The image proxy's own copy
// guards what may render — a separate concern.
export const RECEIPT_FILE_TYPES: readonly string[] = Object.keys(
	MEDIA_KINDS,
).filter((type) => MEDIA_KINDS[type] !== "text");

export function isReceiptFileType(type: string): boolean {
	return RECEIPT_FILE_TYPES.includes(type);
}
