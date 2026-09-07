import { z } from "zod";

// The client sends only where the blob landed; userId/status/channel are server-set
// (session + defaults), so they never appear here — a client can't forge ownership.
const receiptFields = {
	blobUrl: z.url(),
	// The image proxy and worker feed this straight to blob `get()`, which resolves an
	// `https://` value as a URL against a *foreign* store — a store-relative path can't.
	// Reject URLs and `..` traversal here so both sinks only ever read our own store.
	blobPathname: z
		.string()
		.min(1, "Blob pathname is required")
		.refine((p) => !/^https?:\/\//i.test(p) && !p.includes(".."), {
			message: "Blob pathname must be a store-relative path, not a URL",
		}),
	contentType: z.string().optional(),
};

const receiptCreateDto = z.object({ ...receiptFields });

export { receiptCreateDto };
