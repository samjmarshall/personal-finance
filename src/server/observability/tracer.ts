import {
	type Context,
	context,
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { env } from "~/env";

// The one app tracer, keyed on the OTel service name. A no-op proxy until the SDK
// registers (otel.ts), so importing it at module load is safe everywhere.
export const tracer = trace.getTracer(env.PROJECT_NAME);

/** Runs `fn` under a new active span, ended even on a throw. `parent` defaults to the active context. */
export function withSpan<T>(
	name: string,
	{ parent, ...options }: SpanOptions & { parent?: Context },
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return tracer.startActiveSpan(
		name,
		options,
		parent ?? context.active(),
		async (span) => {
			try {
				return await fn(span);
			} finally {
				span.end();
			}
		},
	);
}

// A thrown plain object turns into "[object Object]" as a string; JSON keeps its fields.
function describe(error: unknown): string {
	if (typeof error !== "object" || error === null) return String(error);
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/** Marks `span` failed with `error`. `message` goes on the status, so keep it free of user data. */
export function failSpan(span: Span, error: unknown, message?: string): void {
	span.recordException(error instanceof Error ? error : describe(error));
	span.setStatus({ code: SpanStatusCode.ERROR, message });
}
