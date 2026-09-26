import {
	type Context,
	context,
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { env } from "~/env";
import { type BaggageKey, setBaggage } from "./baggage";
import { stringifyError } from "./logger";

// The one app tracer, keyed on the OTel service name. A no-op proxy until the SDK
// registers (otel.ts), so importing it at module load is safe everywhere.
export const tracer = trace.getTracer(env.PROJECT_NAME);

type WithSpanOptions = SpanOptions & {
	parent?: Context;
	baggage?: Partial<Record<BaggageKey, string>>;
};

/**
 * Runs `fn` under a new active span; a throw fails the span, and it always ends.
 * `parent` defaults to the active context; `baggage` is merged onto it first,
 * since a span copies baggage once at start and anything added inside `fn` is lost.
 */
export function withSpan<T>(
	name: string,
	{ parent, baggage, ...options }: WithSpanOptions,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	const base = parent ?? context.active();
	return tracer.startActiveSpan(
		name,
		options,
		baggage ? setBaggage(baggage, base) : base,
		async (span) => {
			try {
				return await fn(span);
			} catch (error) {
				failSpan(span, error);
				throw error;
			} finally {
				span.end();
			}
		},
	);
}

/** Marks `span` failed with `error`. `message` goes on the status, so keep it free of user data. */
export function failSpan(span: Span, error: unknown, message?: string): void {
	span.recordException(error instanceof Error ? error : stringifyError(error));
	span.setStatus({ code: SpanStatusCode.ERROR, message });
}
