import { context, propagation, trace } from "@opentelemetry/api";
import {
	CompositePropagator,
	W3CBaggagePropagator,
	W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BaggageKey, setBaggage } from "~/server/observability/baggage";
import type { TraceCarrier } from "~/server/observability/trace-carrier";
import type { Equal, Expect } from "~/test/type-contracts";

import { buildOutboxEvent, type EventName, type EventPayload } from "./events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Invariant: buildOutboxEvent appends _trace to every event's data.
type WithTrace = { _trace: TraceCarrier };

// No provider is registered in this block, so `captureTraceCarrier` returns `{}`.
describe("buildOutboxEvent (no SDK registered)", () => {
	it("mints a descriptor carrying a uuid id, the name, and the parsed payload with an empty trace pocket", () => {
		const event = buildOutboxEvent("receipt/uploaded", { receiptId: 1 });

		expect(event.name).toBe("receipt/uploaded");
		expect(event.data).toEqual({ receiptId: 1, _trace: expect.any(Object) });
		expect((event.data as WithTrace)._trace).toEqual({});
		expect(event.id).toMatch(UUID);
	});

	it("mints a distinct id per call (each is its own idempotency key)", () => {
		const a = buildOutboxEvent("receipt/uploaded", { receiptId: 1 });
		const b = buildOutboxEvent("receipt/uploaded", { receiptId: 1 });

		expect(a.id).not.toBe(b.id);
	});

	it("throws when the payload fails the registry schema", () => {
		expect(() =>
			// @ts-expect-error — receiptId must be a number (the integer receipt PK)
			buildOutboxEvent("receipt/uploaded", { receiptId: "r1" }),
		).toThrow();
	});
});

describe("buildOutboxEvent (active trace)", () => {
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

	it("captures the active trace id into _trace.traceparent", () => {
		const span = provider.getTracer("test").startSpan("root");
		const traceId = span.spanContext().traceId;

		const event = context.with(trace.setSpan(context.active(), span), () =>
			buildOutboxEvent("receipt/uploaded", { receiptId: 1 }),
		);
		span.end();

		const carrier = (event.data as WithTrace)._trace;
		expect(carrier.traceparent).toContain(traceId);
	});

	// Inbound baggage can carry anything; only our own keys may be stored at rest.
	it("persists our baggage keys and drops foreign ones", () => {
		const span = provider.getTracer("test").startSpan("root");
		const withForeign = propagation.setBaggage(
			trace.setSpan(context.active(), span),
			propagation.createBaggage({ "vendor.session": { value: "secret" } }),
		);

		const event = context.with(
			setBaggage({ [BaggageKey.MemberId]: "m1" }, withForeign),
			() => buildOutboxEvent("receipt/uploaded", { receiptId: 1 }),
		);
		span.end();

		expect((event.data as WithTrace)._trace.baggage).toBe(
			`${BaggageKey.MemberId}=m1`,
		);
	});
});

// Compile-time contracts: erased at runtime, checked by `make check`.
type _NameIsRegistryKeys = Expect<
	Equal<
		EventName,
		"receipt/uploaded" | "receipt/email.received" | "receipt/retry"
	>
>;
type _PayloadShape = Expect<
	Equal<EventPayload<"receipt/uploaded">, { receiptId: number }>
>;
