import {
	type Context,
	context,
	isSpanContextValid,
	propagation,
	ROOT_CONTEXT,
	trace,
} from "@opentelemetry/api";
import { scrubBaggage } from "./baggage";

export interface TraceCarrier {
	traceparent?: string;
	tracestate?: string;
	baggage?: string;
}

/** Key under which W3C trace context is stored inside an outbox event's `data`. */
export const TRACE_CARRIER_KEY = "_trace" as const;

/** Captures W3C traceparent, tracestate, and baggage from the active (or supplied) context. Returns `{}` when no SDK is registered. */
export function captureTraceCarrier(ctx = context.active()): TraceCarrier {
	const carrier: TraceCarrier = {};
	// Scrub baggage to BAGGAGE_KEYS before injecting: foreign/inbound baggage must
	// never ride into the persisted pocket (adr016 clause 2). traceparent/tracestate
	// come from the span context, which scrubBaggage leaves untouched.
	propagation.inject(scrubBaggage(ctx), carrier);
	return carrier;
}

/**
 * Restores a Context from a previously captured carrier. Returns `null` when
 * the carrier is absent, not a plain object, or carries an invalid span context
 * — the consumer must start a new root trace in that case.
 */
export function restoreTraceCarrier(carrier: unknown): Context | null {
	if (
		carrier === null ||
		typeof carrier !== "object" ||
		Array.isArray(carrier)
	) {
		return null;
	}

	const obj = carrier as Record<string, unknown>;
	const clean: Record<string, string> = {};
	for (const key of ["traceparent", "tracestate", "baggage"] as const) {
		if (typeof obj[key] === "string") {
			clean[key] = obj[key] as string;
		}
	}

	const restored = propagation.extract(ROOT_CONTEXT, clean);
	const spanCtx = trace.getSpanContext(restored);
	if (!spanCtx || !isSpanContextValid(spanCtx)) {
		return null;
	}

	return restored;
}
