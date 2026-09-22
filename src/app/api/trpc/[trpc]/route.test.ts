import { context, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// route.ts is a composition root over the whole app router; stub what it wires
// so this stays a unit over the responseMeta trace-id echo.
vi.mock("~/server/api/root", () => ({ appRouter: {} }));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: vi.fn() }));
vi.mock("~/server/observability/flush", () => ({ flushTelemetry: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { traceIdResponseMeta } = await import("./route");

// A registered provider installs the async-hooks context manager, so context.with
// actually propagates the active span (a bare @opentelemetry/api uses a noop one).
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());

describe("traceIdResponseMeta", () => {
	it("echoes the active span's trace id as x-trace-id", () => {
		const span = trace.getTracer("test").startSpan("root");
		const { traceId } = span.spanContext();

		const meta = context.with(trace.setSpan(context.active(), span), () =>
			traceIdResponseMeta(),
		);
		span.end();

		expect((meta.headers as Record<string, string>)["x-trace-id"]).toBe(
			traceId,
		);
	});

	it("sets no x-trace-id when there is no active span", () => {
		expect(traceIdResponseMeta().headers).toBeUndefined();
	});
});
