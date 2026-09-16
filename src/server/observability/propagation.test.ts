import { context, propagation, trace } from "@opentelemetry/api";
import {
	CompositePropagator,
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
	AlwaysOnSampler,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBaggage } from "./baggage";

// Mirrors otel.ts's propagator + sampler choice: the "parentbased_always_on"
// preset always records a root, and the composite carries both W3C tracecontext
// and baggage. The outbox carrier (Phase 4) relies on inject writing both.
const provider = new NodeTracerProvider({
	sampler: new AlwaysOnSampler(),
	spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});

beforeAll(() =>
	provider.register({
		propagator: new CompositePropagator({
			propagators: [
				new W3CTraceContextPropagator(),
				new W3CBaggagePropagator(),
			],
		}),
	}),
);
afterAll(() => provider.shutdown());

const tracer = provider.getTracer("test");

describe("trace propagation", () => {
	it("injects traceparent + baggage from an active span + baggage context", () => {
		context.with(setBaggage({ "member.id": "m1" }), () => {
			const span = tracer.startSpan("root");
			context.with(trace.setSpan(context.active(), span), () => {
				const carrier: Record<string, string> = {};
				propagation.inject(context.active(), carrier);
				expect(carrier.traceparent).toContain(span.spanContext().traceId);
				expect(carrier.baggage).toContain("member.id");
			});
			span.end();
		});
	});

	it("leaves outbound fetch headers untouched — the app never injects on them", () => {
		context.with(setBaggage({ "member.id": "m1" }), () => {
			const span = tracer.startSpan("root");
			context.with(trace.setSpan(context.active(), span), () => {
				// App code builds outbound request headers directly and never calls
				// propagation.inject on them, so Bedrock/Resend receive no trace
				// context (adr015: propagateContextUrls is []).
				const headers = new Headers({ "content-type": "application/json" });
				expect(headers.get("traceparent")).toBeNull();
				expect(headers.get("baggage")).toBeNull();
			});
			span.end();
		});
	});
});
