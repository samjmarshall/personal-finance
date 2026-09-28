import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const RESPONSE_OBJECT = "ai.response.object";
const RESPONSE_TEXT = "ai.response.text";

export interface AiOutputProcessorDeps {
	inner: SpanProcessor;
}

/**
 * Wraps the PostHog AI processor so `generateObject` output shows on
 * `$ai_generation`: PostHog builds the output only from the response text, but
 * structured calls record it as the response object. Other exporters see the
 * span untouched.
 */
export class AiOutputProcessor implements SpanProcessor {
	private readonly inner: SpanProcessor;

	constructor(deps: AiOutputProcessorDeps) {
		this.inner = deps.inner;
	}

	onStart(span: Span, parentContext: Context): void {
		this.inner.onStart(span, parentContext);
	}

	onEnd(span: ReadableSpan): void {
		this.inner.onEnd(withResponseText(span));
	}

	forceFlush(): Promise<void> {
		return this.inner.forceFlush();
	}

	shutdown(): Promise<void> {
		return this.inner.shutdown();
	}
}

// An ended span can't take new attributes, so hand on a view with the copy added.
function withResponseText(span: ReadableSpan): ReadableSpan {
	const object = span.attributes[RESPONSE_OBJECT];
	if (
		typeof object !== "string" ||
		span.attributes[RESPONSE_TEXT] !== undefined
	)
		return span;
	return Object.create(span, {
		attributes: {
			value: { ...span.attributes, [RESPONSE_TEXT]: object },
			enumerable: true,
		},
	});
}
