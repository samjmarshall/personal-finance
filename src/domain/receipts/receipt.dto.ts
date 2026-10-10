import { z } from "zod";

// The client sends only where the blob landed; userId/status/channel are server-set
// (session + defaults), so they never appear here — a client can't forge ownership.
const receiptFields = {
	blobUrl: z.url(),
	// The image proxy and worker feed this straight to blob `get()`, which resolves an
	// `https://` value as a URL against a *foreign* store — a store-relative path can't.
	// Reject URLs and `..` traversal here so both sinks only ever read our own store.
	// URL parsing turns `%2e` into `.` and `\` into `/`, so those count as traversal too.
	blobPathname: z
		.string()
		.min(1, "Blob pathname is required")
		.refine((p) => !/^https?:\/\//i.test(p) && !/\.\.|%2e|\\/i.test(p), {
			message: "Blob pathname must be a store-relative path, not a URL",
		}),
	contentType: z.string().optional(),
};

const receiptCreateDto = z.object({ ...receiptFields });
export type ReceiptCreateInput = z.infer<typeof receiptCreateDto>;

const receiptRefDto = z.object({ receiptId: z.number().int() });

// timeZone is the viewer's IANA zone. Ranking compares a bare calendar date against
// transaction *instants*, so the day each instant counts as has to be resolved in
// someone's zone — the viewer's, so the "2 days earlier" label agrees with the date
// rendered beside it. An unknown zone falls back to the server's rather than throwing.
const receiptMatchDto = receiptRefDto.extend({ timeZone: z.string().min(1) });

const receiptConfirmMatchDto = receiptRefDto.extend({
	transactionId: z.number().int(),
});

// Both attribution writes are nullable: picking "None" clears the link rather than
// forcing the member to invent an expense/category for an item that has none.
const receiptItemExpenseDto = z.object({
	itemId: z.number().int(),
	expenseId: z.number().int().nullable(),
});

const receiptItemCategoryDto = z.object({
	itemId: z.number().int(),
	categoryId: z.number().int().nullable(),
});

export {
	receiptConfirmMatchDto,
	receiptCreateDto,
	receiptItemCategoryDto,
	receiptItemExpenseDto,
	receiptMatchDto,
};
