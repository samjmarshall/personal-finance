import type { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { PostHogSpanProcessor } from "@posthog/ai/otel";

export interface RegisteredProcessors {
	traceBatch: BatchSpanProcessor;
	posthogSpanProcessor: PostHogSpanProcessor;
	logBatch: BatchLogRecordProcessor;
}

// Holds the processor handles in a leaf module (type-only imports) so flush.ts
// can force-flush before a serverless freeze without importing otel.ts's exporter
// stack — a static edge into otel.ts would drag @vercel/otel + the OTLP exporters
// into every route bundle that flushes. otel.ts sets it once; flush.ts reads it.
let registered: RegisteredProcessors | null = null;

export function getRegisteredProcessors(): RegisteredProcessors | null {
	return registered;
}

export function setRegisteredProcessors(
	processors: RegisteredProcessors,
): void {
	registered = processors;
}
