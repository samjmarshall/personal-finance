import {
	isSpanContextValid,
	type SpanContext,
	TraceFlags,
	trace,
} from "@opentelemetry/api";

// Active span's context, or null when OTel is off or the id is all-zero. Unsampled
// still counts: logs and issues from one run can join on it even if no trace ships.
export function currentSpanContext(): SpanContext | null {
	const ctx = trace.getActiveSpan()?.spanContext();
	return ctx && isSpanContextValid(ctx) ? ctx : null;
}

// Trace id to store on a receipt or echo in a header (adr016/adr020). Null, not "",
// when OTel is off or unsampled, so a saved id always opens a trace that exists.
export function currentTraceId(): string | null {
	const ctx = currentSpanContext();
	const sampled = ctx && (ctx.traceFlags & TraceFlags.SAMPLED) !== 0;
	return sampled ? ctx.traceId : null;
}

// Response header naming the active trace for the Network tab (adr020). Empty
// when nothing records, so keyless local runs send no header.
export function traceIdHeaders(): Record<string, string> {
	const traceId = currentTraceId();
	return traceId ? { "x-trace-id": traceId } : {};
}
