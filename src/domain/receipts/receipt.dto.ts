import { z } from "zod";

// The client sends only where the blob landed; userId/status/channel are server-set
// (session + defaults), so they never appear here — a client can't forge ownership.
const receiptFields = {
	blobUrl: z.url(),
	blobPathname: z.string().min(1, "Blob pathname is required"),
	contentType: z.string().optional(),
};

const receiptCreateDto = z.object({ ...receiptFields });

export { receiptCreateDto };
