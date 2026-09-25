import { type Span, SpanStatusCode } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { PROJECT_NAME: "personal-finance" } }));

const { failSpan, withSpan } = await import("./tracer");

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());

describe("withSpan", () => {
	it("ends the span and returns the result", async () => {
		exporter.reset();

		const result = await withSpan(
			"ok",
			{ attributes: { a: 1 } },
			async () => 7,
		);

		expect(result).toBe(7);
		expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(["ok"]);
		expect(exporter.getFinishedSpans()[0]?.attributes).toEqual({ a: 1 });
	});

	// A span left open on a throw is never exported, so the failure would vanish.
	it("still ends the span when the body throws", async () => {
		exporter.reset();

		await expect(
			withSpan("boom", {}, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual(["boom"]);
	});
});

function fakeSpan() {
	const recorded: unknown[] = [];
	const statuses: unknown[] = [];
	const span = {
		recordException: (e: unknown) => recorded.push(e),
		setStatus: (s: unknown) => statuses.push(s),
	} as unknown as Span;
	return { span, recorded, statuses };
}

describe("failSpan", () => {
	it("records an Error as is", () => {
		const { span, recorded } = fakeSpan();
		const error = new Error("boom");

		failSpan(span, error);

		expect(recorded).toEqual([error]);
	});

	it("keeps a thrown plain object's fields", () => {
		const { span, recorded } = fakeSpan();

		failSpan(span, { code: "E_BLOB", status: 503 });

		expect(recorded).toEqual(['{"code":"E_BLOB","status":503}']);
	});

	it("falls back to a string for an object JSON can't encode", () => {
		const { span, recorded } = fakeSpan();
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		failSpan(span, circular);

		expect(recorded).toEqual(["[object Object]"]);
	});

	it("sets an error status with no message unless given one", () => {
		const { span, statuses } = fakeSpan();

		failSpan(span, "nope");

		expect(statuses).toEqual([
			{ code: SpanStatusCode.ERROR, message: undefined },
		]);
	});
});
