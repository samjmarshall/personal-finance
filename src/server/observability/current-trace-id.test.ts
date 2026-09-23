import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentTraceId } from "./current-trace-id";

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
});
