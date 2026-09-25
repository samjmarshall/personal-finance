import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { env } from "~/env";

// The one app tracer, keyed on the OTel service name. A no-op proxy until the SDK
// registers (otel.ts), so importing it at module load is safe everywhere.
export const tracer = trace.getTracer(env.PROJECT_NAME);

/** Marks `span` failed with `error`. `message` goes on the status, so keep it free of user data. */
export function failSpan(span: Span, error: unknown, message?: string): void {
	span.recordException(error instanceof Error ? error : String(error));
	span.setStatus({ code: SpanStatusCode.ERROR, message });
}
