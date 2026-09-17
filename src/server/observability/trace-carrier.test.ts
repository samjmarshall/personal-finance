import { context, propagation, trace } from "@opentelemetry/api";
import {
	CompositePropagator,
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBaggage } from "./baggage";
import { captureTraceCarrier, restoreTraceCarrier } from "./trace-carrier";

const provider = new NodeTracerProvider();

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

describe("captureTraceCarrier", () => {
	it("captures traceparent matching the active span and baggage carrying member.id", () => {
		context.with(setBaggage({ "member.id": "m1" }), () => {
			const span = tracer.startSpan("root");
			context.with(trace.setSpan(context.active(), span), () => {
				const carrier = captureTraceCarrier();
				expect(carrier.traceparent).toContain(span.spanContext().traceId);
				expect(carrier.baggage).toContain("member.id");
			});
			span.end();
		});
	});

	it("returns an empty carrier when no span or baggage is active", () => {
		expect(captureTraceCarrier()).toEqual({});
	});

	// adr016 clause 2: only BAGGAGE_KEYS may reach the persisted pocket. A foreign
	// key (e.g. an inbound `baggage` header) must be dropped, not injected.
	it("drops baggage keys outside BAGGAGE_KEYS from the captured carrier", () => {
		const seeded = propagation.setBaggage(
			context.active(),
			propagation.createBaggage({
				"member.id": { value: "m1" },
				secret: { value: "leaked" },
			}),
		);
		context.with(seeded, () => {
			const span = tracer.startSpan("root");
			context.with(trace.setSpan(context.active(), span), () => {
				const carrier = captureTraceCarrier();
				expect(carrier.baggage).toContain("member.id");
				expect(carrier.baggage).not.toContain("secret");
			});
			span.end();
		});
	});
});

describe("restoreTraceCarrier", () => {
	it("round-trips a captured carrier: same traceId and baggage member.id", () => {
		context.with(setBaggage({ "member.id": "m1" }), () => {
			const span = tracer.startSpan("root");
			const traceId = span.spanContext().traceId;
			const carrier = context.with(trace.setSpan(context.active(), span), () =>
				captureTraceCarrier(),
			);
			span.end();

			const restored = restoreTraceCarrier(carrier);
			expect(restored).not.toBeNull();
			// biome-ignore lint/style/noNonNullAssertion: asserted non-null above.
			const restoredCtx = restored!;
			expect(trace.getSpanContext(restoredCtx)?.traceId).toBe(traceId);
			expect(
				propagation.getBaggage(restoredCtx)?.getEntry("member.id")?.value,
			).toBe("m1");
		});
	});

	it.each([
		["empty object", {}],
		["undefined", undefined],
		["null", null],
		["string", "string"],
		["garbage traceparent", { traceparent: "garbage" }],
	])("returns null for %s", (_label, input) => {
		expect(restoreTraceCarrier(input)).toBeNull();
	});
});
