import { createHash } from "node:crypto";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	APICallError,
	type FilePart,
	generateObject,
	type ImagePart,
	type LanguageModel,
	type TextPart,
} from "ai";

import {
	type ExtractionCategory,
	type ReceiptExtraction,
	receiptExtractionDto,
} from "~/domain/receipts";
import { env } from "~/env";
import { ReceiptStatus } from "~/lib/constants";
import { bareMediaType, isPdf, isText } from "~/lib/utils";
import type { BlobStore } from "~/server/blob-store/blob-store";
import { setBaggage } from "~/server/observability/baggage";
import type { Logger } from "~/server/observability/logger";
import type {
	ReceiptItemInsert,
	ReceiptsRepository,
} from "./receipts.repository";

// Ambient tracer, no-op until an SDK is registered (otel.ts).
const tracer = trace.getTracer(env.PROJECT_NAME);

// Terminal states: a re-delivered event (Inngest is at-least-once) for one of these
// must return without a second AI call.
const DONE_STATUSES = [ReceiptStatus.Processed, ReceiptStatus.Duplicate];

// The prompt asks for YYYY-MM-DD but the model can drift (regional formats, blank
// when the receipt has none); anything else would fail the `date` column insert and
// roll back the whole extraction, so an off-format date is dropped rather than fatal.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Bedrock Converse caps a message at 3.75 MB per image and 4.5 MB per document (AWS
// `Message` API reference), while uploads and inbound attachments accept 10 MB. Read
// as decimal MB — the conservative side of AWS's figure. Over the cap the call would
// 400 deterministically, so the service refuses first and says so. A text body is
// inlined into the prompt, not sent as a media block, so it carries no byte cap here.
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
// line that says what to do about it — the same split the outbox makes for lastError.
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

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

// Only the email Channel sends markup, so only it gets this. A photo upload has no
// greeting or footer to read past, and the vendor warning would be nonsense there.
const FORWARDED_EMAIL_HINT =
	"The payload is a forwarded e-receipt email rather than a photo of a receipt. Read past the greeting, forwarding headers, promotions and footer to the order lines, and treat the merchant that issued the order as the vendor — never the mail provider or the person who forwarded it.";

/**
 * Prompt listing the household's categories by id so each item comes back with a
 * prefilled `expenseCategoryId`. The id/name list is the only allowed vocabulary —
 * the model must map to one of these or return null, never coin a new category.
 * `mediaType` only selects the forwarded-email preamble; it never changes the schema.
 */
export function buildExtractionPrompt(
	categories: ExtractionCategory[],
	mediaType?: string,
): string {
	const list = categories.map((c) => `- ${c.id}: ${c.name}`).join("\n");
	const hint = isText(mediaType) ? FORWARDED_EMAIL_HINT : "";
	return `Extract the receipt's vendor, date (YYYY-MM-DD), grand total, currency, and every line item (name, price, quantity).
${hint}
For each item, set expenseCategoryId to the id of the single best-matching category below, or null when none clearly fits. Only use an id from this list — never invent one:
${list}`;
}

/**
 * AI-SDK user content for one receipt, routed by media type. A text body returns a
 * *single* part — prompt and markup merged; PDF/image return prompt + payload part.
 */
export function buildExtractionContent({
	prompt,
	bytes,
	mediaType,
}: {
	prompt: string;
	bytes: Uint8Array;
	mediaType: string;
}): Array<TextPart | ImagePart | FilePart> {
	// Markup sent as an image part reaches the model as unreadable noise; inline it.
	// Untrusted third-party HTML — never render it in the browser.
	if (isText(mediaType)) {
		return [
			{
				type: "text",
				text: `${prompt}\n\n${new TextDecoder().decode(bytes)}`,
			},
		];
	}
	return [
		{ type: "text", text: prompt },
		isPdf(mediaType)
			? // Bare type, not the blob's raw header: Anthropic rejects a file part whose
				// media type carries parameters.
				{ type: "file", data: bytes, mediaType: bareMediaType(mediaType) }
			: { type: "image", image: bytes },
	];
}

// Error Tracking sink, an object port so the test fakes it as a plain literal.
// The park path captures its own terminal failures: process() parks, it does not
// throw (the frozen retry contract), so Inngest's onRunError choke point (adr015 §7)
// never sees a terminal receipt failure. Bound to posthog captureException in the
// composition root; a no-op without POSTHOG_KEY.
export interface ErrorReporter {
	captureException(error: unknown, props?: Record<string, unknown>): void;
}

interface ReceiptsServiceDeps {
	repository: ReceiptsRepository;
	blobStore: BlobStore;
	// The provider is bound once in the composition root (functions.ts), so this tier
	// never touches `~/env` or `~/server/aws/bedrock` — see bedrock-invocation.md.
	languageModel: LanguageModel;
	logger: Logger;
	errorReporter: ErrorReporter;
}

/**
 * Application tier for receipt extraction. All I/O (bytes, model, rows) is behind
 * injected ports so tests run offline.
 */
export class ReceiptsService {
	private readonly repository: ReceiptsRepository;
	private readonly blobStore: BlobStore;
	private readonly languageModel: LanguageModel;
	private readonly logger: Logger;
	private readonly errorReporter: ErrorReporter;

	constructor({
		repository,
		blobStore,
		languageModel,
		logger,
		errorReporter,
	}: ReceiptsServiceDeps) {
		this.repository = repository;
		this.blobStore = blobStore;
		this.languageModel = languageModel;
		this.logger = logger;
		this.errorReporter = errorReporter;
	}

	/**
	 * Turn a pending receipt into extracted vendor/total/date + items, or short-circuit
	 * as a duplicate. Idempotent — safe on Inngest's at-least-once redelivery:
	 *   - already processed/duplicate → return, no re-spend
	 *   - same bytes (contentHash) as a finished receipt → mark duplicate, no AI call
	 *   - over the model's byte cap → park as `failed` (too large), no AI call
	 *   - transient provider error with attempts left → rethrow so Inngest retries
	 *   - any other failure (or the final attempt) → park as `failed` with the reason
	 */
	async process(
		receiptId: number,
		{ isFinalAttempt = false }: { isFinalAttempt?: boolean } = {},
	): Promise<void> {
		const receipt = await this.repository.findById(receiptId);
		if (!receipt || DONE_STATUSES.includes(receipt.status)) return;

		// One span + baggage scope per attempt: member.id/receipt.id ride the baggage so
		// the AI generation, the failure log and the captured exception all correlate to
		// this trace. member.id may be null (auth row deleted) — setBaggage skips it.
		const baggageCtx = setBaggage({
			"receipt.id": String(receiptId),
			"member.id": receipt.userId ?? undefined,
		});
		await context.with(baggageCtx, () =>
			tracer.startActiveSpan(
				"receipt.extract",
				{
					attributes: {
						"receipt.id": receiptId,
						"receipt.channel": receipt.channel,
						"receipt.is_final_attempt": isFinalAttempt,
					},
				},
				async (span) => {
					try {
						// Read by store-relative pathname, never the member-supplied blobUrl: the
						// store resolves a pathname against our own token, so a foreign URL can't be
						// fetched and fed to the model (the DTO already rejects a URL pathname).
						const { bytes, mediaType } = await this.blobStore.read(
							receipt.blobPathname,
						);
						const contentHash = sha256(bytes);
						await this.repository.setContentHash(receiptId, contentHash);
						if (await this.linkDuplicate(receiptId, contentHash)) {
							span.setAttribute("receipt.outcome", "duplicate");
							return;
						}

						assertWithinModelCap(bytes, mediaType);
						await this.extractAndSave(receiptId, bytes, mediaType);
						span.setAttribute("receipt.outcome", "processed");
					} catch (error) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });

						// A retryable provider error (429/5xx/network) is worth another go with
						// backoff; a schema, FK or blob failure is deterministic and would just re-spend.
						const retryable =
							APICallError.isInstance(error) && error.isRetryable === true;
						if (retryable && !isFinalAttempt) {
							span.setAttribute("receipt.outcome", "retry");
							this.logger.warn("receipt extraction retrying", {
								error,
								"receipt.id": receiptId,
								"receipt.channel": receipt.channel,
								"receipt.is_final_attempt": isFinalAttempt,
							});
							throw error;
						}

						span.setAttribute("receipt.outcome", "failed");
						const reason = memberFacingError(error);
						this.logger.error("receipt extraction failed", {
							error,
							"event.name": "receipt.failed",
							"receipt.id": receiptId,
							"receipt.channel": receipt.channel,
							"receipt.is_final_attempt": isFinalAttempt,
							"receipt.reason": reason,
						});
						// onRunError never sees a parked run, so the domain tier owns the Error
						// Tracking signal for terminal failures (adr015 §7 note). Inside the span
						// + baggage above, so the issue carries $trace_id + member.id.
						this.errorReporter.captureException(error, {
							"receipt.id": String(receiptId),
							"receipt.channel": receipt.channel,
							"member.id": receipt.userId,
							"receipt.reason": reason,
						});
						await this.repository.markFailed(receiptId, reason);
					} finally {
						span.end();
					}
				},
			),
		);
	}

	// Dedup on the exact bytes: a re-upload of a photo we already extracted links back
	// to it instead of paying for a second identical extraction.
	private async linkDuplicate(
		receiptId: number,
		contentHash: string,
	): Promise<boolean> {
		const dup = await this.repository.findProcessedByHash(
			contentHash,
			receiptId,
		);
		if (!dup) return false;
		await this.repository.markDuplicate(receiptId, dup.id);
		return true;
	}

	private async extractAndSave(
		receiptId: number,
		bytes: Uint8Array,
		mediaType: string,
	): Promise<void> {
		const categories = await this.repository.listExpenseCategories();
		const extracted = await this.analyzeReceipt({
			categories,
			bytes,
			mediaType,
		});

		// The prompt forbids invented ids, but a hallucinated one would trip the FK
		// and roll back the whole extraction; drop it to null rather than lose the receipt.
		const knownCategoryIds = new Set(categories.map((c) => c.id));
		const items: ReceiptItemInsert[] = extracted.items.map((i) => ({
			name: i.name,
			price: i.price,
			quantity: i.quantity,
			expenseCategoryId:
				i.expenseCategoryId !== null &&
				knownCategoryIds.has(i.expenseCategoryId)
					? i.expenseCategoryId
					: null,
		}));

		await this.repository.saveExtraction(
			receiptId,
			{
				vendor: extracted.vendor,
				receiptDate: ISO_DATE.test(extracted.receiptDate)
					? extracted.receiptDate
					: null,
				total: extracted.total,
				currency: extracted.currency,
				rawJson: extracted,
			},
			items,
		);
	}

	private async analyzeReceipt({
		categories,
		bytes,
		mediaType,
	}: {
		categories: ExtractionCategory[];
		bytes: Uint8Array;
		mediaType: string;
	}): Promise<ReceiptExtraction> {
		const prompt = buildExtractionPrompt(categories, mediaType);
		const content = buildExtractionContent({ prompt, bytes, mediaType });

		const { object } = await generateObject({
			model: this.languageModel,
			schema: receiptExtractionDto,
			messages: [{ role: "user", content }],
			// v7 telemetry is opt-out once @ai-sdk/otel is registered (otel.ts); inputs
			// record by default, so ContextSpanProcessor redaction must be registered
			// first or the base64 receipt image ships raw. functionId groups the runs.
			telemetry: {
				isEnabled: true,
				recordInputs: true,
				recordOutputs: true,
				functionId: "receipt.extract",
			},
		});

		return object;
	}
}
