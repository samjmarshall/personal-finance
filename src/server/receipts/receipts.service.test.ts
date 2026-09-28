import { createHash } from "node:crypto";
import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import {
	context,
	propagation,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { APICallError, type LanguageModel, registerTelemetry } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { ExtractionCategory, ReceiptExtraction } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { FetchedBlob } from "~/server/blob-store/blob-store";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import type {
	ExtractionValues,
	ReceiptItemInsert,
	ReceiptRow,
	ReceiptsRepository,
} from "./receipts.repository";
import {
	buildExtractionContent,
	buildExtractionPrompt,
	type ErrorReporter,
	ReceiptsService,
} from "./receipts.service";

type LogEntry = { level: string; msg: string; attrs: LogAttributes };
type Capture = { error: unknown; props?: Record<string, unknown> };

const baseReceipt = (over: Partial<ReceiptRow> = {}): ReceiptRow => ({
	id: 1,
	status: ReceiptStatus.Pending,
	channel: ReceiptChannel.Upload,
	userId: "u1",
	blobUrl: "https://blob.example/r1.jpg",
	blobPathname: "r1.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: null,
	receiptDate: null,
	total: null,
	currency: null,
	rawJson: null,
	error: null,
	traceId: null,
	transactionId: null,
	duplicateOfId: null,
	createdAt: new Date(),
	updatedAt: null,
	...over,
});

const extraction: ReceiptExtraction = {
	vendor: "Corner Grocer",
	receiptDate: "2026-08-14",
	total: 8.99,
	currency: "USD",
	items: [
		{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
		{ name: "Bread", price: 2.5, quantity: 2, expenseCategoryId: null },
	],
};

const okBlob: FetchedBlob = {
	bytes: new Uint8Array([1, 2, 3]),
	mediaType: "image/jpeg",
};
const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

// Register a provider so both spans land and are assertable; LegacyOpenTelemetry
// mirrors prod and preserves the ai.* span name format.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
	provider.register();
	registerTelemetry(new LegacyOpenTelemetry());
});
// Restore the global no-op tracer; a shut-down provider left installed would leak
// into later test files sharing the worker (order-dependent flakes).
afterAll(async () => {
	await provider.shutdown();
	trace.disable();
	context.disable();
	propagation.disable();
});
beforeEach(() => exporter.reset());

// Fake ports are plain object literals against the interfaces. Every repository
// write lands in `calls`, and `log` keeps the cross-port order so a test can assert
// what happened before what (hash persisted before the model call, etc.).
function harness(
	opts: {
		receipt?: ReceiptRow;
		dup?: { id: number };
		categories?: ExtractionCategory[];
		blob?: FetchedBlob;
		extract?: () => Promise<ReceiptExtraction>;
		languageModel?: LanguageModel;
	} = {},
) {
	const log: string[] = [];
	const calls = {
		setContentHash: [] as { id: number; contentHash: string }[],
		markDuplicate: [] as { id: number; duplicateOfId: number }[],
		saveExtraction: [] as {
			id: number;
			values: ExtractionValues;
			items: ReceiptItemInsert[];
		}[],
		markFailed: [] as { id: number; error: string }[],
	};

	const repository: ReceiptsRepository = {
		findById: async () => opts.receipt,
		setContentHash: async (id, contentHash) => {
			log.push("setContentHash");
			calls.setContentHash.push({ id, contentHash });
		},
		findProcessedByHash: async () => opts.dup,
		markDuplicate: async (id, duplicateOfId) => {
			log.push("markDuplicate");
			calls.markDuplicate.push({ id, duplicateOfId });
		},
		listExpenseCategories: async () => opts.categories ?? [],
		saveExtraction: async (id, values, items) => {
			log.push("saveExtraction");
			calls.saveExtraction.push({ id, values, items });
		},
		markFailed: async (id, error) => {
			log.push("markFailed");
			calls.markFailed.push({ id, error });
		},
	};
	const blobStore = {
		read: vi.fn(async () => opts.blob ?? okBlob),
		write: vi.fn(async () => {
			throw new Error("unused");
		}),
	};
	// Binding returns the same fake: only the composition root binds, once.
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};
	const captures: Capture[] = [];
	const errorReporter: ErrorReporter = {
		captureException: (error, props) => {
			log.push("capture");
			captures.push({ error, props });
		},
	};
	const service = new ReceiptsService({
		repository,
		blobStore,
		languageModel: opts.languageModel ?? ({} as LanguageModel),
		logger,
		errorReporter,
	});
	// Spy the extraction so the flow runs offline by default; pass a real model when
	// the telemetry span must actually emit (the model runs, no spy). `opts.extract`
	// drives the return (or throw); the builders are covered directly below.
	const analyze = opts.languageModel
		? undefined
		: vi
				.spyOn(
					service as unknown as {
						analyzeReceipt(input: {
							mediaType: string;
						}): Promise<ReceiptExtraction>;
					},
					"analyzeReceipt",
				)
				.mockImplementation(async () => {
					log.push("extract");
					return opts.extract ? opts.extract() : extraction;
				});

	return {
		service,
		calls,
		log,
		blobStore,
		analyze,
		logs,
		captures,
	};
}

afterEach(() => vi.restoreAllMocks());

describe("ReceiptsService.process", () => {
	it("extracts, then saves the receipt processed with its items", async () => {
		const h = harness({
			receipt: baseReceipt(),
			categories: [{ id: 7, name: "Groceries" }],
		});

		await h.service.process(1);

		expect(h.analyze).toHaveBeenCalledOnce();
		// contentHash is persisted before the AI call (so dedup can catch a re-upload).
		expect(h.calls.setContentHash).toEqual([
			{ id: 1, contentHash: sha256(okBlob.bytes) },
		]);
		expect(h.log.indexOf("setContentHash")).toBeLessThan(
			h.log.indexOf("extract"),
		);
		expect(h.calls.saveExtraction).toHaveLength(1);
		const saved = h.calls.saveExtraction[0];
		expect(saved?.id).toBe(1);
		expect(saved?.values).toEqual({
			vendor: "Corner Grocer",
			receiptDate: "2026-08-14",
			total: 8.99,
			currency: "USD",
			rawJson: extraction,
		});
		expect(saved?.items).toEqual([
			{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
			{ name: "Bread", price: 2.5, quantity: 2, expenseCategoryId: null },
		]);
		expect(h.calls.markFailed).toEqual([]);
	});

	// The email Channel must land in the same terminal states as an upload: the
	// service stays media-type-blind and passes whatever the blob carried to the
	// extractor, which is what lets buildExtractionContent make the text-vs-image call.
	it("passes an html body's media type through to the extractor and still processes it", async () => {
		const h = harness({
			receipt: baseReceipt({
				channel: ReceiptChannel.Email,
				contentType: "text/html",
				blobPathname: "receipts/email/abc.html",
			}),
			categories: [{ id: 7, name: "Groceries" }],
			blob: {
				bytes: new TextEncoder().encode("<html>Total $8.99</html>"),
				mediaType: "text/html",
			},
		});

		await h.service.process(1);

		expect(h.analyze).toHaveBeenCalledOnce();
		expect(h.analyze).toHaveBeenCalledWith(
			expect.objectContaining({ mediaType: "text/html" }),
		);
		expect(h.calls.saveExtraction).toHaveLength(1);
		expect(h.calls.saveExtraction[0]?.values.vendor).toBe("Corner Grocer");
	});

	it("nulls a category id the model invented instead of failing the whole extraction", async () => {
		const h = harness({
			receipt: baseReceipt(),
			categories: [{ id: 7, name: "Groceries" }],
			extract: async () => ({
				...extraction,
				items: [
					{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
					{ name: "Soap", price: 1.5, quantity: 1, expenseCategoryId: 99 },
				],
			}),
		});

		await h.service.process(1);

		expect(h.calls.saveExtraction[0]?.items).toEqual([
			expect.objectContaining({ name: "Milk", expenseCategoryId: 7 }),
			expect.objectContaining({ name: "Soap", expenseCategoryId: null }),
		]);
	});

	it("nulls a non-ISO receipt date instead of failing the whole extraction", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => ({ ...extraction, receiptDate: "14/08/2026" }),
		});

		await h.service.process(1);

		expect(h.calls.saveExtraction).toHaveLength(1);
		expect(h.calls.saveExtraction[0]?.values.receiptDate).toBeNull();
	});

	it("marks a re-upload duplicate without spending on the AI call", async () => {
		const h = harness({ receipt: baseReceipt(), dup: { id: 42 } });

		await h.service.process(1);

		expect(h.analyze).not.toHaveBeenCalled();
		expect(h.calls.markDuplicate).toEqual([{ id: 1, duplicateOfId: 42 }]);
		expect(h.calls.saveExtraction).toEqual([]);
		// The span records the terminal outcome; a duplicate is not an error.
		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "receipt.extract");
		expect(span?.attributes["receipt.outcome"]).toBe("duplicate");
		expect(h.logs.some((l) => l.level === "error")).toBe(false);
	});

	it("returns early on an already-processed receipt (at-least-once re-delivery, no re-spend)", async () => {
		const h = harness({
			receipt: baseReceipt({ status: ReceiptStatus.Processed }),
		});

		await h.service.process(1);

		expect(h.blobStore.read).not.toHaveBeenCalled();
		expect(h.analyze).not.toHaveBeenCalled();
		expect(h.log).toEqual([]);
		// A no-op re-delivery still opens the span so the trace shows why nothing ran.
		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "receipt.extract");
		expect(span?.attributes["receipt.outcome"]).toBe("skipped");
	});

	it("returns early when the receipt no longer exists", async () => {
		const h = harness();

		await h.service.process(1);

		expect(h.blobStore.read).not.toHaveBeenCalled();
		expect(h.log).toEqual([]);
		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "receipt.extract");
		expect(span?.attributes["receipt.outcome"]).toBe("skipped");
	});

	it("marks the receipt failed when extraction throws", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw new Error("model unavailable");
			},
		});

		await h.service.process(1);

		expect(h.calls.markFailed).toHaveLength(1);
		expect(h.calls.markFailed[0]?.error).toBeTruthy();
		expect(h.calls.saveExtraction).toEqual([]);
	});

	// A parked run never throws, so Inngest's run-error hook never fires — the service
	// must emit the failure alert and capture the error itself.
	it("logs receipt.failed and captures the exception once on the park path", async () => {
		const boom = new Error("model unavailable");
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw boom;
			},
		});

		await h.service.process(1);

		const errors = h.logs.filter((l) => l.level === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.msg).toBe("receipt extraction failed");
		expect(errors[0]?.attrs["event.name"]).toBe("receipt.failed");
		expect(errors[0]?.attrs["receipt.id"]).toBe("1");
		expect(h.logs.some((l) => l.level === "warn")).toBe(false);

		expect(h.captures).toHaveLength(1);
		expect(h.captures[0]?.error).toBe(boom);
		expect(h.captures[0]?.props).toMatchObject({
			"receipt.id": "1",
			"member.id": "u1",
		});
		// A throwing park write must not swallow the real error.
		expect(h.log.indexOf("capture")).toBeLessThan(h.log.indexOf("markFailed"));

		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "receipt.extract");
		expect(span?.status.code).toBe(SpanStatusCode.ERROR);
		expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
	});

	// `error` is rendered to the member verbatim, and a drizzle/postgres error message
	// carries the failing SQL with its bound parameters. Nothing internal may reach it.
	it("stores an actionable message, not the raw driver error", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw new Error(
					'insert into "receipt_item" ... params: 7, secret-vendor',
				);
			},
		});

		await h.service.process(1);

		const error = h.calls.markFailed[0]?.error;
		expect(error).not.toContain("insert into");
		expect(error).not.toContain("secret-vendor");
		expect(error).toContain("Retry");
	});

	const bedrockUrl =
		"https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/au.anthropic.claude-sonnet-4-6/converse";

	const overloaded = () =>
		new APICallError({
			message: "Overloaded",
			url: bedrockUrl,
			requestBodyValues: {},
			statusCode: 529,
			isRetryable: true,
		});

	it("rethrows a retryable API error while attempts remain so Inngest retries", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw overloaded();
			},
		});

		await expect(
			h.service.process(1, { isFinalAttempt: false }),
		).rejects.toThrow("Overloaded");

		expect(h.calls.markFailed).toEqual([]);
		// A mid-retry blip warns (the middleware's onRunError covers the capture); it must
		// not fire the terminal receipt.failed signal or double-capture.
		const warns = h.logs.filter((l) => l.level === "warn");
		expect(warns).toHaveLength(1);
		expect(warns[0]?.msg).toBe("receipt extraction retrying");
		expect(h.logs.some((l) => l.attrs["event.name"] === "receipt.failed")).toBe(
			false,
		);
		expect(h.captures).toEqual([]);

		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "receipt.extract");
		expect(span?.status.code).toBe(SpanStatusCode.ERROR);
		expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
	});

	it("parks a retryable API error as failed on the final attempt", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw overloaded();
			},
		});

		await h.service.process(1, { isFinalAttempt: true });

		expect(h.calls.markFailed[0]?.error).toContain("extraction service");
	});

	// A 400 (ValidationException) or 403 (AccessDenied) from Bedrock is deterministic:
	// the same bytes fail the same way next time, so "Retry in a moment" would mislead.
	it("parks a non-retryable API error at once, without the retry copy", async () => {
		const h = harness({
			receipt: baseReceipt(),
			extract: async () => {
				throw new APICallError({
					message: "ValidationException",
					url: bedrockUrl,
					requestBodyValues: {},
					statusCode: 400,
					isRetryable: false,
				});
			},
		});

		await h.service.process(1, { isFinalAttempt: false });

		expect(h.calls.markFailed).toHaveLength(1);
		expect(h.calls.markFailed[0]?.error).not.toContain("Retry in a moment");
	});

	// Bedrock Converse caps a message at 3.75 MB per image and 4.5 MB per document,
	// while uploads and inbound attachments accept 10 MB. Anything over would 400
	// deterministically — so the service refuses first, without spending the call, and
	// says "too large" rather than the generic retry copy.
	it("parks an oversize PDF as failed with a too-large message and no model call", async () => {
		const h = harness({
			receipt: baseReceipt(),
			blob: { bytes: new Uint8Array(4_500_001), mediaType: "application/pdf" },
		});

		await h.service.process(1);

		expect(h.analyze).not.toHaveBeenCalled();
		const error = h.calls.markFailed[0]?.error;
		expect(error).toContain("too large");
		expect(error).toContain("4.5 MB");
		expect(error).not.toContain("Retry");
	});

	it("parks an oversize image with the smaller image cap in the message", async () => {
		const h = harness({
			receipt: baseReceipt(),
			blob: { bytes: new Uint8Array(3_750_001), mediaType: "image/jpeg" },
		});

		await h.service.process(1);

		expect(h.analyze).not.toHaveBeenCalled();
		expect(h.calls.markFailed[0]?.error).toContain("3.75 MB");
	});

	it("sends a document exactly at the cap through to the model", async () => {
		const h = harness({
			receipt: baseReceipt(),
			blob: { bytes: new Uint8Array(4_500_000), mediaType: "application/pdf" },
		});

		await h.service.process(1);

		expect(h.analyze).toHaveBeenCalledOnce();
		expect(h.calls.saveExtraction).toHaveLength(1);
	});

	// Downstream redaction + PostHog processors key on the ai.generateObject span
	// sitting under receipt.extract on one trace — this pins that contract.
	it("emits an ai.generateObject span under receipt.extract when telemetry runs", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: async () => ({
				finishReason: { unified: "stop" as const, raw: "stop" },
				usage: {
					inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 20, text: 20, reasoning: 0 },
				},
				content: [{ type: "text", text: JSON.stringify(extraction) }],
				warnings: [],
			}),
		});
		const h = harness({
			receipt: baseReceipt(),
			categories: [{ id: 7, name: "Groceries" }],
			languageModel: model,
		});

		await h.service.process(1);

		expect(h.calls.saveExtraction).toHaveLength(1);
		const spans = exporter.getFinishedSpans();
		const extract = spans.find((s) => s.name === "receipt.extract");
		const ai = spans.find((s) => s.name.startsWith("ai.generateObject"));
		expect(extract).toBeDefined();
		expect(ai).toBeDefined();
		expect(ai?.spanContext().traceId).toBe(extract?.spanContext().traceId);
	});
});

describe("buildExtractionPrompt", () => {
	it("lists every category's id and name so the model prefills expenseCategoryId", () => {
		const prompt = buildExtractionPrompt([
			{ id: 7, name: "Groceries" },
			{ id: 9, name: "Household" },
		]);
		expect(prompt).toContain("7");
		expect(prompt).toContain("Groceries");
		expect(prompt).toContain("9");
		expect(prompt).toContain("Household");
	});

	// Stage 5's upload path must not drift: the forwarded-email preamble is written
	// for markup, and on a photo it tells the model to read past a greeting that
	// isn't there. Nothing else pinned this, so a prompt edit went unnoticed once.
	it.each([undefined, "image/jpeg", "application/pdf"])(
		"omits the forwarded-email hint for %s",
		(mediaType) => {
			expect(
				buildExtractionPrompt([{ id: 7, name: "Groceries" }], mediaType),
			).not.toContain("forwarded e-receipt email");
		},
	);

	it.each(["text/html", "text/plain", "text/html; charset=utf-8"])(
		"includes the forwarded-email hint for %s",
		(mediaType) => {
			expect(
				buildExtractionPrompt([{ id: 7, name: "Groceries" }], mediaType),
			).toContain("forwarded e-receipt email");
		},
	);
});

describe("buildExtractionContent", () => {
	const prompt = "Extract the receipt.";
	const bytes = new TextEncoder().encode(
		"<html><body>Total $9.20</body></html>",
	);

	it.each(["application/pdf", "application/pdf; charset=binary"])(
		"sends %s as a file part carrying the bare media type",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toEqual([
				{ type: "text", text: prompt },
				{ type: "file", data: bytes, mediaType: "application/pdf" },
			]);
		},
	);

	it.each(["image/jpeg", "image/png"])(
		"sends %s as an image part",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toEqual([
				{ type: "text", text: prompt },
				{ type: "image", image: bytes },
			]);
		},
	);

	// HEIC is the iPhone default, but the vision model can't read it — reject up front
	// instead of sending bytes the model would 400 on.
	it("rejects image/heic as an unsupported media type", () => {
		expect(() =>
			buildExtractionContent({ prompt, bytes, mediaType: "image/heic" }),
		).toThrow("Unsupported media type: image/heic");
	});

	// The charset form is what the worker actually sees: `mediaType` is the blob's raw
	// HTTP content-type header, not the bare string the producer stored on the row.
	it.each(["text/html", "text/plain", "text/html; charset=utf-8"])(
		"sends %s as a second text part tagged for trace redaction",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			// Guard: HTML as an image part reaches the model as noise, not text.
			expect(content).toEqual([
				{ type: "text", text: prompt },
				{
					type: "text",
					text: "<html><body>Total $9.20</body></html>",
					providerOptions: {
						observability: {
							redact: true,
						},
					},
				},
			]);
		},
	);

	it("decodes html bytes as UTF-8 so non-ASCII vendor names survive", () => {
		const content = buildExtractionContent({
			prompt,
			bytes: new TextEncoder().encode("<p>Café Ubé — €12,50</p>"),
			mediaType: "text/html",
		});
		const part = content[1];
		expect(part?.type === "text" && part.text).toBe("<p>Café Ubé — €12,50</p>");
	});
});
