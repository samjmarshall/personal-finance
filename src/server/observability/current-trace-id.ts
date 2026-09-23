import { trace } from "@opentelemetry/api";

// The ingest trace id to persist on a receipt (adr016/adr018). Null when OTel is
// unregistered — e.g. POSTHOG_KEY unset locally — so callers store null, not "".
export function currentTraceId(): string | null {
	return trace.getActiveSpan()?.spanContext().traceId ?? null;
}
