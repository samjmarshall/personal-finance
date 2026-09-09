import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import { APICallError, generateObject, type LanguageModel } from "ai";
import { and, eq, ne } from "drizzle-orm";
import type { Inngest } from "inngest";
import { ReceiptStatus } from "~/lib/constants";
import { isPdf, isText } from "~/lib/utils";
import type { db as realDb } from "~/server/db";
import { expenseCategories } from "~/server/expenses/categories.schema";
import {
	buildExtractionContent,
	buildExtractionPrompt,
	type ReceiptExtraction,
	receiptExtraction,
} from "./extraction";
import { receiptItems, receipts } from "./receipts.schema";

// Terminal states: a re-delivered event (Inngest is at-least-once) for one of these
// must return without a second AI call.
const DONE_STATUSES = [ReceiptStatus.Processed, ReceiptStatus.Duplicate];

// The prompt asks for YYYY-MM-DD but the model can drift (regional formats, blank
// when the receipt has none); anything else would fail the `date` column insert and
// roll back the whole extraction, so an off-format date is dropped rather than fatal.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Inngest retry budget for transient provider errors (529 overloaded, 429, network).
// The AI SDK already retries twice over ~6s; these back off over minutes to ride out
// a real outage. Explicit so the final-attempt check below can't drift from it.
const RETRIES = 3;

// Bedrock Converse caps a message at 3.75 MB per image and 4.5 MB per document (AWS
// `Message` API reference), while uploads and inbound attachments accept 10 MB. Read
// as decimal MB — the conservative side of AWS's figure. Over the cap the call would
// 400 deterministically, so the core refuses first and says so. A text body is inlined
// into the prompt, not sent as a media block, so it carries no byte cap here.
const MB = 1_000_000;
const BEDROCK_MAX_IMAGE_BYTES = 3.75 * MB;
const BEDROCK_MAX_DOCUMENT_BYTES = 4.5 * MB;

class ReceiptTooLargeError extends Error {
	constructor(readonly maxBytes: number) {
		super(`receipt exceeds the model's ${maxBytes / MB} MB cap`);
	}
}

function assertWithinModelCap(bytes: Uint8Array, mediaType: string): void {
	if (isText(mediaType)) return;
	const max = isPdf(mediaType)
		? BEDROCK_MAX_DOCUMENT_BYTES
		: BEDROCK_MAX_IMAGE_BYTES;
	if (bytes.byteLength > max) throw new ReceiptTooLargeError(max);
}

// `error` is rendered verbatim to the member in the detail overlay, and a driver error's
// message carries the failing SQL with its bound parameters. Log the real thing, store a
// line that says what to do about it — the same split markFailed makes for the outbox.
// Only a retryable provider error earns the "retry" copy: a 400/403 fails the same way
// on every attempt, so telling the member to retry would just waste their time.
function memberFacingError(error: unknown): string {
	if (error instanceof ReceiptTooLargeError)
		return `Receipt is too large to read (max ${error.maxBytes / MB} MB). Delete it and upload a smaller file.`;
	if (APICallError.isInstance(error))
		return error.isRetryable
			? "The extraction service couldn't read this receipt. Retry in a moment."
			: "The extraction service rejected this receipt. Delete it and upload a clearer photo.";
	return "Couldn't extract this receipt. Retry, or delete it and upload a clearer photo.";
}

export interface FetchedBlob {
	bytes: Uint8Array;
	mediaType: string;
}

interface ProcessReceiptCoreDeps {
	db: typeof realDb;
	fetchBlob: (blobPathname: string) => Promise<FetchedBlob>;
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
 *   - over the model's byte cap → park as `failed` (too large), no AI call
 *   - transient provider error with attempts left → rethrow so Inngest retries
 *   - any other failure (or the final attempt) → park as `failed` with the reason
 */
export function makeRunProcessReceipt({
	db,
	fetchBlob,
	generate,
	hash,
}: ProcessReceiptCoreDeps) {
	return async (
		receiptId: number,
		{ isFinalAttempt = false }: { isFinalAttempt?: boolean } = {},
	) => {
		const [receipt] = await db
			.select()
			.from(receipts)
			.where(eq(receipts.id, receiptId));
		if (!receipt || DONE_STATUSES.includes(receipt.status)) return;

		try {
			// Read by store-relative pathname, never the member-supplied blobUrl: `get`
			// resolves a pathname against our own token, so a foreign store URL can't be
			// fetched and fed to the model (the DTO already rejects a URL pathname).
			const { bytes, mediaType } = await fetchBlob(receipt.blobPathname);
			const contentHash = hash(bytes);
			await db
				.update(receipts)
				.set({ contentHash })
				.where(eq(receipts.id, receiptId));

			// Dedup on the exact bytes: a re-upload of a photo we already extracted links
			// back to it instead of paying for a second identical extraction. Only a
			// processed row can be the target — matching duplicates too would let a third
			// upload point at an empty duplicate row instead of the original.
			const [dup] = await db
				.select({ id: receipts.id })
				.from(receipts)
				.where(
					and(
						eq(receipts.contentHash, contentHash),
						ne(receipts.id, receiptId),
						eq(receipts.status, ReceiptStatus.Processed),
					),
				);
			if (dup) {
				await db
					.update(receipts)
					.set({ status: ReceiptStatus.Duplicate, duplicateOfId: dup.id })
					.where(eq(receipts.id, receiptId));
				return;
			}

			assertWithinModelCap(bytes, mediaType);
			const categories = await db
				.select({ id: expenseCategories.id, name: expenseCategories.name })
				.from(expenseCategories);
			const extracted = await generate({
				prompt: buildExtractionPrompt(categories, mediaType),
				bytes,
				mediaType,
			});

			// The prompt forbids invented ids, but a hallucinated one would trip the FK
			// and roll back the whole extraction; drop it to null rather than lose the receipt.
			const knownCategoryIds = new Set(categories.map((c) => c.id));

			await db.transaction(async (tx) => {
				await tx
					.update(receipts)
					.set({
						status: ReceiptStatus.Processed,
						vendor: extracted.vendor,
						receiptDate: ISO_DATE.test(extracted.receiptDate)
							? extracted.receiptDate
							: null,
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
							expenseCategoryId:
								i.expenseCategoryId !== null &&
								knownCategoryIds.has(i.expenseCategoryId)
									? i.expenseCategoryId
									: null,
						})),
					);
				}
			});
		} catch (error) {
			// A retryable provider error (429/5xx/network) is worth another go with
			// backoff; a schema, FK or blob failure is deterministic and would just re-spend.
			const retryable =
				APICallError.isInstance(error) && error.isRetryable === true;
			if (retryable && !isFinalAttempt) throw error;

			console.error(`process-receipt failed for ${receiptId}`, error);
			await db
				.update(receipts)
				.set({
					status: ReceiptStatus.Failed,
					error: memberFacingError(error),
				})
				.where(eq(receipts.id, receiptId));
		}
	};
}

interface WorkerDeps {
	db: typeof realDb;
	inngest: Pick<Inngest, "send" | "createFunction">;
	/** Extraction model, injected so this file stays provider-agnostic and env-free. */
	model: LanguageModel;
}

/**
 * process-receipt worker: real blob fetch + model extraction wired into the pure
 * core. Fires on both the initial upload and an explicit retry.
 */
export function makeProcessReceiptWorker({ db, inngest, model }: WorkerDeps) {
	const runProcessReceipt = makeRunProcessReceipt({
		db,
		fetchBlob: fetchBlobBytes,
		generate: async ({ prompt, bytes, mediaType }) => {
			const { object } = await generateObject({
				model,
				schema: receiptExtraction,
				messages: [
					{
						role: "user",
						content: buildExtractionContent({ prompt, bytes, mediaType }),
					},
				],
			});
			return object;
		},
		hash: (bytes) => createHash("sha256").update(bytes).digest("hex"),
	});

	return inngest.createFunction(
		{
			id: "process-receipt",
			retries: RETRIES,
			// One run at a time per receipt. The status guard above only stops a *later*
			// delivery; two concurrent ones (an at-least-once redelivery racing the first
			// send, or a retry fired mid-run) would both read `pending`, both pay for an
			// extraction, and both insert the line items. Serialised, the second finds
			// `processed` and returns. Keyed on the receipt, so unrelated receipts still
			// run in parallel.
			concurrency: { key: "event.data.receiptId", limit: 1 },
			// All three carry the same `{ receiptId }` payload, so the email Channel
			// rides the upload path's extraction unchanged.
			triggers: [
				{ event: "receipt/uploaded" },
				{ event: "receipt/retry" },
				{ event: "receipt/email.received" },
			],
		},
		({ event, attempt }) =>
			runProcessReceipt(event.data.receiptId, {
				isFinalAttempt: attempt >= RETRIES,
			}),
	);
}

// The Blob store is private, so a bare fetch of the URL 400s — go through the SDK's
// `get`, which signs the request with BLOB_READ_WRITE_TOKEN from the env. Keyed on the
// store-relative pathname so the read is pinned to our own store, never a foreign URL.
async function fetchBlobBytes(blobPathname: string): Promise<FetchedBlob> {
	const result = await get(blobPathname, { access: "private" });
	if (result?.statusCode !== 200) {
		throw new Error(`blob fetch failed for ${blobPathname}`);
	}
	const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
	return { bytes, mediaType: result.blob.contentType };
}
