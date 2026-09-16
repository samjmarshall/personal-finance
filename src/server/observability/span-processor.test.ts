import { createHash } from "node:crypto";
import { context } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setBaggage } from "./baggage";
import { ContextSpanProcessor } from "./span-processor";

function makeMessages(parts: unknown[]) {
	return JSON.stringify([{ role: "user", content: parts }]);
}

function filePart(b64: string, mediaType = "image/jpeg") {
	return { type: "file", data: b64, mediaType };
}

function textPart(text: string) {
	return { type: "text", text };
}

const exporter = new InMemorySpanExporter();
const processor = new ContextSpanProcessor({
	inputTokenPriceUsd: 0.003,
	outputTokenPriceUsd: 0.015,
});
const provider = new NodeTracerProvider({
	spanProcessors: [processor, new SimpleSpanProcessor(exporter)],
});

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

const tracer = provider.getTracer("test");

// Helper: start + immediately end a span with explicit context and attributes.
function runSpan(
	name: string,
	ctx = context.active(),
	attrs: Record<string, string> = {},
) {
	tracer.startActiveSpan(name, { attributes: attrs }, ctx, (span) => {
		span.end();
	});
	return exporter.getFinishedSpans()[0];
}

describe("ContextSpanProcessor", () => {
	describe("baggage → span attrs", () => {
		it("copies known baggage keys onto the span", () => {
			const ctx = setBaggage({ "member.id": "m1", "receipt.id": "42" });
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["member.id"]).toBe("m1");
			expect(span?.attributes["receipt.id"]).toBe("42");
		});

		it("sets posthog.distinct_id from member.id", () => {
			const ctx = setBaggage({ "member.id": "m1" });
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["posthog.distinct_id"]).toBe("m1");
		});

		it("does not set posthog.distinct_id when member.id absent", () => {
			const ctx = setBaggage({ "receipt.id": "7" });
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["posthog.distinct_id"]).toBeUndefined();
		});
	});

	describe("ai.prompt.messages redaction", () => {
		it("does not redact file parts on a non-ai.* span", () => {
			const b64 = Buffer.from("hello").toString("base64");
			const messages = makeMessages([filePart(b64)]);
			const span = runSpan("outbox.deliver", context.active(), {
				"ai.prompt.messages": messages,
			});

			expect(span?.attributes["ai.prompt.messages"]).toBe(messages);
		});

		it("redacts file parts on an ai.* span; text parts are unchanged", () => {
			const bytes = Buffer.from("binary-image-content");
			const b64 = bytes.toString("base64");
			const sha = createHash("sha256").update(bytes).digest("hex");
			const messages = makeMessages([
				filePart(b64, "image/jpeg"),
				textPart("describe this"),
			]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			const parts: Array<{ type: string; data?: string; text?: string }> =
				out[0].content;

			// File part replaced with compact stub.
			expect(parts[0]?.data).toBe(
				`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
			);
			// Text part untouched.
			expect(parts[1]?.text).toBe("describe this");
		});

		it("a 3 MB base64 file part reduces to a stub under 200 bytes", () => {
			const bigBytes = Buffer.alloc(3 * 1024 * 1024, 0xab);
			const b64 = bigBytes.toString("base64");
			const messages = makeMessages([filePart(b64, "image/jpeg")]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			const stub: string = out[0].content[0].data;

			expect(stub.startsWith("<redacted")).toBe(true);
			expect(Buffer.byteLength(stub, "utf8")).toBeLessThan(200);
		});

		it("handles image type parts as well as file type parts", () => {
			const bytes = Buffer.from("raw-image");
			const b64 = bytes.toString("base64");
			const sha = createHash("sha256").update(bytes).digest("hex");
			const messages = makeMessages([
				{ type: "image", data: b64, mediaType: "image/png" },
			]);

			const span = runSpan("ai.generateText.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].data).toBe(
				`<redacted image/png ${bytes.byteLength} sha256:${sha}>`,
			);
		});

		it("leaves unparsable ai.prompt.messages untouched", () => {
			const bad = "not valid json {{{";
			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": bad,
			});

			expect(span?.attributes["ai.prompt.messages"]).toBe(bad);
		});

		it("leaves ai.prompt.messages untouched when mediaType is absent", () => {
			const bytes = Buffer.from("data");
			const b64 = bytes.toString("base64");
			const sha = createHash("sha256").update(bytes).digest("hex");
			// No mediaType field — falls back to application/octet-stream.
			const messages = makeMessages([{ type: "file", data: b64 }]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].data).toBe(
				`<redacted application/octet-stream ${bytes.byteLength} sha256:${sha}>`,
			);
		});
	});

	describe("binary redaction — real payload shapes", () => {
		it("redacts an image part carrying raw Uint8Array bytes (receipts shape)", () => {
			// receipts.service.ts emits { type: "image", image: <Uint8Array> }, which
			// serializes to a numeric-keyed object — not a base64 string.
			const bytes = new Uint8Array(Buffer.from("raw-receipt-jpeg-bytes"));
			const sha = createHash("sha256").update(bytes).digest("hex");
			const messages = makeMessages([
				{ type: "image", image: bytes, mediaType: "image/jpeg" },
			]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].image).toBe(
				`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
			);
		});

		it("redacts a Node Buffer-shaped payload ({ type: 'Buffer', data })", () => {
			const buf = Buffer.from("node-buffer-pdf-bytes");
			const sha = createHash("sha256").update(buf).digest("hex");
			const messages = makeMessages([
				{ type: "file", data: buf, mediaType: "application/pdf" },
			]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].data).toBe(
				`<redacted application/pdf ${buf.byteLength} sha256:${sha}>`,
			);
		});

		it("redacts binary in the outer ai.prompt attribute", () => {
			// The generate* outer span wraps messages in { system, prompt, messages }
			// under `ai.prompt` — a separate leak path from `ai.prompt.messages`.
			const bytes = new Uint8Array(Buffer.from("outer-span-receipt-bytes"));
			const sha = createHash("sha256").update(bytes).digest("hex");
			const prompt = JSON.stringify({
				system: "extract the receipt",
				messages: [
					{
						role: "user",
						content: [
							{ type: "image", image: bytes, mediaType: "image/jpeg" },
							textPart("extract"),
						],
					},
				],
			});

			const span = runSpan("ai.generateObject", context.active(), {
				"ai.prompt": prompt,
			});

			const out = JSON.parse(span?.attributes["ai.prompt"] as string);
			expect(out.messages[0].content[0].image).toBe(
				`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
			);
			expect(out.messages[0].content[1].text).toBe("extract");
			expect(out.system).toBe("extract the receipt");
		});

		it("leaves an http reference URL untouched (not decoded as base64)", () => {
			const url = "https://blob.example/receipt.jpg";
			const messages = makeMessages([
				{ type: "image", image: url, mediaType: "image/jpeg" },
			]);

			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].image).toBe(url);
		});
	});

	describe("typed attributes preserved over baggage", () => {
		it("does not clobber a number attr set at start with a baggage string", () => {
			// receipt.id is stamped as a number at span start; the baggage copy is a
			// string — the typed value must win so filters don't split on type.
			const ctx = setBaggage({ "receipt.id": "42" });
			tracer.startActiveSpan(
				"receipt.process",
				{ attributes: { "receipt.id": 42 } },
				ctx,
				(span) => span.end(),
			);

			const span = exporter.getFinishedSpans()[0];
			expect(span?.attributes["receipt.id"]).toBe(42);
		});
	});

	describe("price attributes", () => {
		it("stamps price attrs on ai.* spans when configured", () => {
			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": makeMessages([]),
			});

			expect(span?.attributes.$ai_input_token_price).toBe(0.003);
			expect(span?.attributes.$ai_output_token_price).toBe(0.015);
		});

		it("omits price attrs on non-ai.* spans", () => {
			const span = runSpan("trpc.receipt.create");

			expect(span?.attributes.$ai_input_token_price).toBeUndefined();
			expect(span?.attributes.$ai_output_token_price).toBeUndefined();
		});

		it("omits price attrs on ai.* spans when processor has no prices", () => {
			const noPrice = new ContextSpanProcessor();
			const exp = new InMemorySpanExporter();
			const prov = new NodeTracerProvider({
				spanProcessors: [noPrice, new SimpleSpanProcessor(exp)],
			});
			const t = prov.getTracer("test-no-price");

			t.startActiveSpan(
				"ai.generateObject.doGenerate",
				{ attributes: { "ai.prompt.messages": makeMessages([]) } },
				context.active(),
				(span) => {
					span.end();
				},
			);

			const [span] = exp.getFinishedSpans();
			expect(span?.attributes.$ai_input_token_price).toBeUndefined();
			expect(span?.attributes.$ai_output_token_price).toBeUndefined();

			return prov.shutdown();
		});
	});
});
