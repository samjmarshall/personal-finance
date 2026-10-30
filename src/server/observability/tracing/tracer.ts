import {
	type Context,
	context,
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { env } from "~/env";
import { stringifyThrown } from "~/server/observability/errors/thrown";
import { type BaggageEntries, setBaggage } from "./baggage";

// The one app tracer, keyed on the OTel service name. Looked up per span, not at
// module load: @opentelemetry/api >=1.10 ships separate ESM and CJS copies, and a
// tracer taken early from one copy never sees the SDK registered (otel.ts) via the other.
const getTracer = () => trace.getTracer(env.PROJECT_NAME);

type WithSpanOptions = SpanOptions & {
	parent?: Context;
	baggage?: BaggageEntries;
};

/**
 * Runs `fn` under a new active span; a throw fails the span, and it always ends.
 * An error `fn` catches and doesn't rethrow leaves the span clean; call `failSpan` for it.
 * `parent` defaults to the active context; `baggage` is merged onto it first,
 * since a span copies baggage once at start and anything added inside `fn` is lost.
 */
export function withSpan<T>(
	name: string,
	{ parent, baggage, ...options }: WithSpanOptions,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	const base = parent ?? context.active();
	return getTracer().startActiveSpan(
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
	span.recordException(error instanceof Error ? error : stringifyThrown(error));
	span.setStatus({ code: SpanStatusCode.ERROR, message });
}
