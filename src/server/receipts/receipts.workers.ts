import { createHash } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import { get } from "@vercel/blob";
import { generateObject } from "ai";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Inngest } from "inngest";
import { ReceiptStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { expenseCategories } from "~/server/expenses/categories.schema";
import {
	buildExtractionPrompt,
	RECEIPT_MODEL,
	type ReceiptExtraction,
	receiptExtraction,
} from "./extraction";
import { receiptItems, receipts } from "./receipts.schema";

// Terminal states: a re-delivered event (Inngest is at-least-once) for one of these
// must return without a second AI call.
const DONE_STATUSES = [ReceiptStatus.Processed, ReceiptStatus.Duplicate];

export interface FetchedBlob {
	bytes: Uint8Array;
	mediaType: string;
}

interface ProcessReceiptCoreDeps {
	db: typeof realDb;
	fetchBlob: (blobUrl: string) => Promise<FetchedBlob>;
	generate: (input: {
		prompt: string;
		bytes: Uint8Array;
		mediaType: string;
	}) => Promise<ReceiptExtraction>;
	hash: (bytes: Uint8Array) => string;
}

/**
 * Pure worker core: turn a pending receipt into extracted vendor/total/date + items,
 * or short-circuit as a duplicate. All I/O (blob bytes, AI call, hashing) is injected
 * so tests run offline. Idempotent by design — safe on Inngest's at-least-once redelivery:
 *   - already processed/duplicate → return, no re-spend
 *   - same photo (contentHash) as a finished receipt → mark duplicate, no AI call
 *   - any failure → park as `failed` with the reason so the user can retry
 */
export function makeRunProcessReceipt({
	db,
	fetchBlob,
	generate,
	hash,
}: ProcessReceiptCoreDeps) {
	return async function runProcessReceipt(receiptId: number) {
		const [receipt] = await db
			.select()
			.from(receipts)
			.where(eq(receipts.id, receiptId));
		if (!receipt || DONE_STATUSES.includes(receipt.status)) return;

		try {
			const { bytes, mediaType } = await fetchBlob(receipt.blobUrl);
			const contentHash = hash(bytes);
			await db
				.update(receipts)
				.set({ contentHash })
				.where(eq(receipts.id, receiptId));

			// Dedup on the exact bytes: a re-upload of a photo we already extracted links
			// back to it instead of paying for a second identical extraction.
			const [dup] = await db
				.select({ id: receipts.id })
				.from(receipts)
				.where(
					and(
						eq(receipts.contentHash, contentHash),
						ne(receipts.id, receiptId),
						inArray(receipts.status, DONE_STATUSES),
					),
				);
			if (dup) {
				await db
					.update(receipts)
					.set({ status: ReceiptStatus.Duplicate, duplicateOfId: dup.id })
					.where(eq(receipts.id, receiptId));
				return;
			}

			const categories = await db
				.select({ id: expenseCategories.id, name: expenseCategories.name })
				.from(expenseCategories);
			const extracted = await generate({
				prompt: buildExtractionPrompt(categories),
				bytes,
				mediaType,
			});

			await db.transaction(async (tx) => {
				await tx
					.update(receipts)
					.set({
						status: ReceiptStatus.Processed,
						vendor: extracted.vendor,
						receiptDate: extracted.receiptDate,
						total: extracted.total,
						currency: extracted.currency,
						rawJson: extracted,
					})
					.where(eq(receipts.id, receiptId));
				if (extracted.items.length > 0) {
					await tx.insert(receiptItems).values(
						extracted.items.map((i) => ({
							receiptId,
							name: i.name,
							price: i.price,
							quantity: i.quantity,
							expenseCategoryId: i.expenseCategoryId,
						})),
					);
				}
			});
		} catch (error) {
			await db
				.update(receipts)
				.set({
					status: ReceiptStatus.Failed,
					error: error instanceof Error ? error.message : String(error),
				})
				.where(eq(receipts.id, receiptId));
		}
	};
}

interface WorkerDeps {
	db: typeof realDb;
	inngest: Pick<Inngest, "send" | "createFunction">;
}

/**
 * process-receipt worker: real blob fetch + Claude Vision extraction wired into the
 * pure core. Fires on both the initial upload and an explicit retry.
 */
export function makeProcessReceiptWorker({ db, inngest }: WorkerDeps) {
	const runProcessReceipt = makeRunProcessReceipt({
		db,
		fetchBlob: fetchBlobBytes,
		generate: async ({ prompt, bytes, mediaType }) => {
			// PDFs ride as a file part; everything else is an image part.
			const filePart =
				mediaType === "application/pdf"
					? { type: "file" as const, data: bytes, mediaType }
					: { type: "image" as const, image: bytes };
			const { object } = await generateObject({
				model: anthropic(RECEIPT_MODEL),
				schema: receiptExtraction,
				messages: [
					{ role: "user", content: [{ type: "text", text: prompt }, filePart] },
				],
			});
			return object;
		},
		hash: (bytes) => createHash("sha256").update(bytes).digest("hex"),
	});

	return inngest.createFunction(
		{
			id: "process-receipt",
			triggers: [{ event: "receipt/uploaded" }, { event: "receipt/retry" }],
		},
		({ event }) => runProcessReceipt(event.data.receiptId),
	);
}

// The Blob store is private, so a bare fetch of the URL 400s — go through the SDK's
// `get`, which signs the request with BLOB_READ_WRITE_TOKEN from the env.
async function fetchBlobBytes(blobUrl: string): Promise<FetchedBlob> {
	const result = await get(blobUrl, { access: "private" });
	if (result?.statusCode !== 200) {
		throw new Error(`blob fetch failed for ${blobUrl}`);
	}
	const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
	return { bytes, mediaType: result.blob.contentType };
}
