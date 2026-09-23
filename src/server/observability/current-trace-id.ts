import {
	isSpanContextValid,
	type SpanContext,
	trace,
} from "@opentelemetry/api";

// The active span's context, or null when OTel is unregistered/unsampled or the
// context is all-zero (invalid). The single home for the getActiveSpan→spanContext
// walk + validity guard, so no caller re-walks it or persists a "000…0" id.
export function currentSpanContext(): SpanContext | null {
	const ctx = trace.getActiveSpan()?.spanContext();
	return ctx && isSpanContextValid(ctx) ? ctx : null;
}

// The ingest trace id to persist on a receipt (adr016/adr018). Null when OTel is
// unregistered — e.g. POSTHOG_KEY unset locally — so callers store null, not "".
export function currentTraceId(): string | null {
	return currentSpanContext()?.traceId ?? null;
}
