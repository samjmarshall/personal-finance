import { context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
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
import { BaggageKey, setBaggage } from "./baggage";

// Same propagators as prod; roots always record. Outbox carrier needs both
// trace context and baggage written.
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
		context.with(setBaggage({ [BaggageKey.MemberId]: "m1" }), () => {
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

	it("injects nothing on a context with no active span or baggage (the empty carrier captureTraceCarrier relies on)", () => {
		const carrier: Record<string, string> = {};
		propagation.inject(ROOT_CONTEXT, carrier);

		expect(carrier.traceparent).toBeUndefined();
		expect(carrier.baggage).toBeUndefined();
	});
});
