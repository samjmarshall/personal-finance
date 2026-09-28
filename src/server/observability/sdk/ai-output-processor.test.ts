import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { AiOutputProcessor } from "./ai-output-processor";

function harness() {
	const ended: ReadableSpan[] = [];
	const inner: SpanProcessor = {
		onStart: () => {},
		onEnd: (span) => ended.push(span),
		forceFlush: async () => {},
		shutdown: async () => {},
	};
	return { ended, processor: new AiOutputProcessor({ inner }) };
}

function span(attributes: ReadableSpan["attributes"]): ReadableSpan {
	return { name: "ai.generateObject.doGenerate", attributes } as ReadableSpan;
}

describe("AiOutputProcessor", () => {
	it("copies the response object into the response text for the inner processor", () => {
		const h = harness();
		const original = span({ "ai.response.object": '{"total":12}' });

		h.processor.onEnd(original);

		expect(h.ended[0]?.attributes["ai.response.text"]).toBe('{"total":12}');
		expect(h.ended[0]?.name).toBe("ai.generateObject.doGenerate");
		// The shared span stays as recorded for the other exporters.
		expect(original.attributes["ai.response.text"]).toBeUndefined();
	});

	it("keeps an existing response text", () => {
		const h = harness();
		const original = span({
			"ai.response.object": "{}",
			"ai.response.text": "hi",
		});

		h.processor.onEnd(original);

		expect(h.ended[0]).toBe(original);
	});

	it("passes a span with no response object through unchanged", () => {
		const h = harness();
		const original = span({ "http.method": "GET" });

		h.processor.onEnd(original);

		expect(h.ended[0]).toBe(original);
	});

	it("forwards onStart to the inner processor", () => {
		const started: Span[] = [];
		const inner: SpanProcessor = {
			onStart: (s) => started.push(s),
			onEnd: () => {},
			forceFlush: async () => {},
			shutdown: async () => {},
		};
		const s = {} as Span;

		new AiOutputProcessor({ inner }).onStart(s, {} as Context);

		expect(started).toEqual([s]);
	});
});
