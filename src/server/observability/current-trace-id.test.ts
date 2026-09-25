import {
	context,
	INVALID_SPAN_CONTEXT,
	TraceFlags,
	trace,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentTraceId, traceIdHeaders } from "./current-trace-id";

// A registered provider installs the async-hooks context manager, so context.with
// actually propagates the active span (a bare @opentelemetry/api uses a noop one).
const provider = new NodeTracerProvider();
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());

describe("currentTraceId", () => {
	it("returns null when no span is active", () => {
		expect(currentTraceId()).toBeNull();
	});

	it("returns the active span's 32-hex lowercase trace id", () => {
		const span = trace.getTracer("test").startSpan("root");
		const { traceId } = span.spanContext();

		const id = context.with(trace.setSpan(context.active(), span), () =>
			currentTraceId(),
		);
		span.end();

		expect(id).toBe(traceId);
		expect(id).toMatch(/^[0-9a-f]{32}$/);
	});

	it("returns null for an all-zero (invalid) span context", () => {
		const id = context.with(
			trace.setSpanContext(context.active(), INVALID_SPAN_CONTEXT),
			() => currentTraceId(),
		);
		expect(id).toBeNull();
	});

	// A dropped span is never exported, so its id would link to nothing.
	it("returns null for an unsampled span context", () => {
		const id = context.with(
			trace.setSpanContext(context.active(), {
				traceId: "0af7651916cd43dd8448eb211c80319c",
				spanId: "b7ad6b7169203331",
				traceFlags: TraceFlags.NONE,
			}),
			() => currentTraceId(),
		);
		expect(id).toBeNull();
	});
});

describe("traceIdHeaders", () => {
	it("echoes the active span's trace id as x-trace-id", () => {
		const span = trace.getTracer("test").startSpan("root");
		const { traceId } = span.spanContext();

		const headers = context.with(trace.setSpan(context.active(), span), () =>
			traceIdHeaders(),
		);
		span.end();

		expect(headers).toEqual({ "x-trace-id": traceId });
	});

	it("sets no x-trace-id when there is no active span", () => {
		expect(traceIdHeaders()).toEqual({});
	});
});
