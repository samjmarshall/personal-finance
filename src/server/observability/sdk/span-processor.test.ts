import { context } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BaggageKey, setBaggage } from "~/server/observability/tracing/baggage";
import { SpanAttributeProcessor } from "./span-processor";

function makeMessages(parts: unknown[]) {
	return JSON.stringify([{ role: "user", content: parts }]);
}

function filePart(b64: string, mediaType = "image/jpeg") {
	return { type: "file", data: b64, mediaType };
}

const exporter = new InMemorySpanExporter();
const processor = new SpanAttributeProcessor({
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

describe("SpanAttributeProcessor", () => {
	describe("baggage → span attrs", () => {
		it("copies known baggage keys onto the span", () => {
			const ctx = setBaggage({
				[BaggageKey.MemberId]: "m1",
				[BaggageKey.ReceiptId]: "42",
			});
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["member.id"]).toBe("m1");
			expect(span?.attributes["receipt.id"]).toBe("42");
		});

		it("sets posthog.distinct_id from member.id", () => {
			const ctx = setBaggage({ [BaggageKey.MemberId]: "m1" });
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["posthog.distinct_id"]).toBe("m1");
		});

		it("does not set posthog.distinct_id when member.id absent", () => {
			const ctx = setBaggage({ [BaggageKey.ReceiptId]: "7" });
			const span = runSpan("some.op", ctx);

			expect(span?.attributes["posthog.distinct_id"]).toBeUndefined();
		});
	});

	// Redaction correctness (every payload shape) lives in prompt-redaction.test.ts;
	// here we prove only the processor's gate + delegation — off for non-ai.* spans,
	// on for ai.* spans.
	describe("prompt redaction (delegated)", () => {
		it("does not redact prompt attributes on a non-ai.* span", () => {
			const messages = makeMessages([
				filePart(Buffer.from("hello").toString("base64")),
			]);
			const span = runSpan("outbox.deliver", context.active(), {
				"ai.prompt.messages": messages,
			});

			expect(span?.attributes["ai.prompt.messages"]).toBe(messages);
		});

		it("redacts binary in the prompt attribute on an ai.* span", () => {
			const messages = makeMessages([
				filePart(Buffer.from("binary-image-content").toString("base64")),
			]);
			const span = runSpan("ai.generateObject.doGenerate", context.active(), {
				"ai.prompt.messages": messages,
			});

			const out = JSON.parse(span?.attributes["ai.prompt.messages"] as string);
			expect(out[0].content[0].data as string).toMatch(
				/^<redacted image\/jpeg /,
			);
		});
	});

	describe("typed attributes preserved over baggage", () => {
		it("does not clobber a number attr set at start with a baggage string", () => {
			// receipt.id is stamped as a number at span start; the baggage copy is a
			// string — the typed value must win so filters don't split on type.
			const ctx = setBaggage({ [BaggageKey.ReceiptId]: "42" });
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
			const noPrice = new SpanAttributeProcessor();
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
