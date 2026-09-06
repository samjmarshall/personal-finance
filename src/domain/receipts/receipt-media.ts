// The private-blob proxy route (src/app/api/receipts/[id]/image); the store can't
// be loaded directly, so every <img>/link goes through here.
export function receiptImageUrl(id: number): string {
	return `/api/receipts/${id}/image`;
}
