import { createHash } from "node:crypto";
import type { Span } from "@opentelemetry/api";
import {
	APICallError,
	type FilePart,
	generateObject,
	type ImagePart,
	type LanguageModel,
	NoObjectGeneratedError,
	type TextPart,
} from "ai";

import {
	type ExtractionCategory,
	type ReceiptExtraction,
	type ReceiptMediaKind,
	receiptExtractionDto,
	receiptMediaKind,
} from "~/domain/receipts";
import { ReceiptStatus } from "~/lib/constants";
import { bareMediaType } from "~/lib/utils";
import type { BlobStore } from "~/server/blob-store/blob-store";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { BaggageKey } from "~/server/observability/tracing/baggage";
import { REDACT_IN_TELEMETRY } from "~/server/observability/tracing/redact-tag";
import { failSpan, withSpan } from "~/server/observability/tracing/tracer";
import type {
	ReceiptItemInsert,
	ReceiptRow,
	ReceiptsRepository,
} from "./receipts.repository";

// Terminal states: a re-delivered event (Inngest is at-least-once) for one of these
// must return without a second AI call.
const DONE_STATUSES = [ReceiptStatus.Processed, ReceiptStatus.Duplicate];

// Telemetry-only labels for one run's result, not the saved DB status.
// Two of these ("skipped", "retry") are never persisted.
enum ReceiptOutcome {
	Skipped = "skipped",
	Duplicate = "duplicate",
	Processed = "processed",
	Retry = "retry",
	Failed = "failed",
}

// The prompt asks for YYYY-MM-DD but the model can drift (regional formats, blank
// when the receipt has none); anything else would fail the `date` column insert and
// roll back the whole extraction, so an off-format date is dropped rather than fatal.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Bedrock Converse caps a message at 3.75 MB per image and 4.5 MB per document (AWS
// `Message` API reference), while uploads and inbound attachments accept 10 MB. Read
// as decimal MB — the conservative side of AWS's figure. Over the cap the call would
// 400 deterministically, so the service refuses first and says so. A text body is
// inlined into the prompt, so Bedrock never caps it; ours bounds its input tokens
// (~100k at 300 KB of markup, where a real e-receipt runs 30–150 KB).
const KB = 1_000;
const MB = 1_000_000;
const BEDROCK_MAX_IMAGE_BYTES = 3.75 * MB;
const BEDROCK_MAX_DOCUMENT_BYTES = 4.5 * MB;
const MAX_TEXT_BYTES = 300 * KB;

// Unset, Bedrock lets the model write to its full output max, so a model stuck
// repeating line items bills all of it. At ~45 tokens an item this still fits ~170;
// a normal receipt uses 300–2k. A cut-off reply fails to parse and parks, never retried.
const MAX_OUTPUT_TOKENS = 8192;
// A full 8k reply takes ~140s; this stops a hung call inside the Inngest route's 300s.
const MODEL_TIMEOUT_MS = 150_000;
// The AI SDK default, pinned: it retries only 429/5xx/network, which bill no output.
const MODEL_MAX_RETRIES = 2;

function formatBytes(bytes: number): string {
	return bytes >= MB ? `${bytes / MB} MB` : `${bytes / KB} KB`;
}

class ReceiptTooLargeError extends Error {
	constructor(readonly maxBytes: number) {
		super(`receipt exceeds the model's ${formatBytes(maxBytes)} cap`);
	}
}

// Only the email Channel sends markup, so only it gets this. A photo upload has no
// greeting or footer to read past, and the vendor warning would be nonsense there.
const FORWARDED_EMAIL_HINT =
	"The payload is a forwarded e-receipt email rather than a photo of a receipt. Read past the greeting, forwarding headers, promotions and footer to the order lines, and treat the merchant that issued the order as the vendor — never the mail provider or the person who forwarded it.";

type PayloadPart = TextPart | ImagePart | FilePart;

// Everything the model call varies by media kind, so a new kind is one entry here.
const MODEL_MEDIA: Record<
	ReceiptMediaKind,
	{
		maxBytes: number;
		hint: string;
		payload: (bytes: Uint8Array, mediaType: string) => PayloadPart;
	}
> = {
	image: {
		maxBytes: BEDROCK_MAX_IMAGE_BYTES,
		hint: "",
		payload: (bytes) => ({ type: "image", image: bytes }),
	},
	pdf: {
		maxBytes: BEDROCK_MAX_DOCUMENT_BYTES,
		hint: "",
		// Bare type, not the blob's raw header: Anthropic rejects a file part whose
		// media type carries parameters.
		payload: (bytes, mediaType) => ({
			type: "file",
			data: bytes,
			mediaType: bareMediaType(mediaType),
		}),
	},
	// Markup sent as an image part reaches the model as unreadable noise; inline it.
	// Untrusted third-party HTML — never render it in the browser.
	text: {
		maxBytes: MAX_TEXT_BYTES,
		hint: FORWARDED_EMAIL_HINT,
		payload: (bytes) => ({
			type: "text",
			text: new TextDecoder().decode(bytes),
			providerOptions: REDACT_IN_TELEMETRY,
		}),
	},
};

function modelMedia(mediaType: string) {
	const kind = receiptMediaKind(mediaType);
	if (!kind) throw new Error(`Unsupported media type: ${mediaType}`);
	return MODEL_MEDIA[kind];
}

function assertWithinModelCap(bytes: Uint8Array, mediaType: string): void {
	const { maxBytes } = modelMedia(mediaType);
	if (bytes.byteLength > maxBytes) throw new ReceiptTooLargeError(maxBytes);
}

// `error` is rendered verbatim to the member in the detail overlay, and a driver error's
// message carries the failing SQL with its bound parameters. Log the real thing, store a
// line that says what to do about it — the same split the outbox makes for lastError.
// Only a retryable provider error earns the "retry" copy: a 400/403 fails the same way
// on every attempt, so telling the member to retry would just waste their time. Nor
// does a reply cut off at MAX_OUTPUT_TOKENS: the same receipt cuts off the same way.
function memberFacingError(error: unknown): string {
	if (error instanceof ReceiptTooLargeError)
		return `Receipt is too large to read (max ${formatBytes(error.maxBytes)}). Delete it and upload a smaller file.`;
	if (
		NoObjectGeneratedError.isInstance(error) &&
		error.finishReason === "length"
	)
		return "Receipt has too many lines to read in one go. Delete it and upload it in smaller parts.";
	if (APICallError.isInstance(error))
		return error.isRetryable
			? "The extraction service couldn't read this receipt. Retry in a moment."
			: "The extraction service rejected this receipt. Delete it and upload a clearer photo.";
	return "Couldn't extract this receipt. Retry, or delete it and upload a clearer photo.";
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

// Attrs that bind a failure log/capture to this receipt + its channel, so the retry
// warn, the terminal error and the captured exception all land on one trace.
function failureAttrs(
	receiptId: number,
	receipt: ReceiptRow | undefined,
): LogAttributes {
	return {
		[BaggageKey.ReceiptId]: String(receiptId),
		"receipt.channel": receipt?.channel,
	};
}

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
	const kind = receiptMediaKind(mediaType);
	const hint = kind ? MODEL_MEDIA[kind].hint : "";
	return `Extract the receipt's vendor, date (YYYY-MM-DD), grand total, currency, and every line item (name, price, quantity).
${hint}
For each item, set expenseCategoryId to the id of the single best-matching category below, or null when none clearly fits. Only use an id from this list — never invent one:
${list}`;
}

/** AI-SDK user content for one receipt, routed by media type: prompt + payload part. */
export function buildExtractionContent({
	prompt,
	bytes,
	mediaType,
}: {
	prompt: string;
	bytes: Uint8Array;
	mediaType: string;
}): PayloadPart[] {
	return [
		{ type: "text", text: prompt },
		modelMedia(mediaType).payload(bytes, mediaType),
	];
}

// Park path never throws, so Inngest's run-error hook misses terminal failures —
// this port lets the service own the Error Tracking signal (adr015 §7).
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
		const receiptIdStr = String(receiptId);

		// Baggage carries the receipt + member ids so every downstream span, log and
		// captured error lands on this trace; member is left off when the sign-in row
		// is gone.
		await withSpan(
			"receipt.extract",
			{
				attributes: { "receipt.is_final_attempt": isFinalAttempt },
				baggage: {
					[BaggageKey.ReceiptId]: receiptIdStr,
					[BaggageKey.MemberId]: receipt?.userId ?? undefined,
				},
			},
			async (span) => {
				try {
					// A re-delivered event for a finished receipt, or one whose row is gone,
					// does no work — tagged so the trace still shows why nothing happened.
					if (!receipt || DONE_STATUSES.includes(receipt.status)) {
						span.setAttribute("receipt.outcome", ReceiptOutcome.Skipped);
						return;
					}
					span.setAttribute("receipt.channel", receipt.channel);

					// Read by store-relative pathname, never the member-supplied blobUrl: the
					// store resolves a pathname against our own token, so a foreign URL can't be
					// fetched and fed to the model (the DTO already rejects a URL pathname).
					const { bytes, mediaType } = await this.blobStore.read(
						receipt.blobPathname,
					);
					const contentHash = sha256(bytes);
					await this.repository.setContentHash(receiptId, contentHash);
					if (await this.linkDuplicate(receiptId, contentHash)) {
						span.setAttribute("receipt.outcome", ReceiptOutcome.Duplicate);
						return;
					}

					assertWithinModelCap(bytes, mediaType);
					await this.extractAndSave(receiptId, bytes, mediaType);
					span.setAttribute("receipt.outcome", ReceiptOutcome.Processed);
				} catch (error) {
					await this.parkFailure(span, error, {
						receipt,
						receiptId,
						isFinalAttempt,
					});
				}
			},
		);
	}

	// Rethrows the original error for a retryable failure with attempts left (Inngest
	// then retries); otherwise parks the row and reports the terminal failure.
	private async parkFailure(
		span: Span,
		error: unknown,
		{
			receipt,
			receiptId,
			isFinalAttempt,
		}: {
			receipt: ReceiptRow | undefined;
			receiptId: number;
			isFinalAttempt: boolean;
		},
	): Promise<void> {
		const attrs = failureAttrs(receiptId, receipt);

		// A retryable provider error (429/5xx/network) is worth another go with
		// backoff; a schema, FK or blob failure is deterministic and would just re-spend.
		const retryable =
			APICallError.isInstance(error) && error.isRetryable === true;
		if (retryable && !isFinalAttempt) {
			span.setAttribute("receipt.outcome", ReceiptOutcome.Retry);
			this.logger.warn("receipt extraction retrying", {
				error,
				...attrs,
				"receipt.is_final_attempt": isFinalAttempt,
			});
			throw error;
		}

		failSpan(span, error);
		span.setAttribute("receipt.outcome", ReceiptOutcome.Failed);
		const reason = memberFacingError(error);
		this.logger.error("receipt extraction failed", {
			error,
			"event.name": "receipt.failed",
			...attrs,
			"receipt.is_final_attempt": isFinalAttempt,
			"receipt.reason": reason,
		});
		// Parked runs don't throw, so Inngest's run-error hook never sees them (adr015 §7).
		// Capture before the park write, so a failed write can't swallow the real error.
		this.errorReporter.captureException(error, {
			...attrs,
			[BaggageKey.MemberId]: receipt?.userId,
			"receipt.reason": reason,
		});
		await this.repository.markFailed(receiptId, reason);
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
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			maxRetries: MODEL_MAX_RETRIES,
			abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
			// Inputs record by default — the redaction step must be registered first or
			// the base64 receipt image ships raw to the trace backend. functionId groups
			// the runs.
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
