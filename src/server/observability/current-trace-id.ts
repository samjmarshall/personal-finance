import {
	isSpanContextValid,
	type SpanContext,
	TraceFlags,
	trace,
} from "@opentelemetry/api";

// The active span's context, or null when OTel is unregistered/unsampled or the
// context is all-zero (invalid). The single home for the getActiveSpan→spanContext
// walk + validity guard, so no caller re-walks it or persists a "000…0" id.
export function currentSpanContext(): SpanContext | null {
	const ctx = trace.getActiveSpan()?.spanContext();
	const sampled = ctx && (ctx.traceFlags & TraceFlags.SAMPLED) !== 0;
	return ctx && sampled && isSpanContextValid(ctx) ? ctx : null;
}

// The ingest trace id to persist on a receipt (adr016/adr020). Null when OTel is
// unregistered — e.g. POSTHOG_KEY unset locally — so callers store null, not "".
export function currentTraceId(): string | null {
	return currentSpanContext()?.traceId ?? null;
}

// Response header naming the active trace for the Network tab (adr020). Empty
// when nothing records, so keyless local runs send no header.
export function traceIdHeaders(): Record<string, string> {
	const traceId = currentTraceId();
	return traceId ? { "x-trace-id": traceId } : {};
}
