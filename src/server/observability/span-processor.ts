import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { BaggageKey, readBaggage } from "./baggage";
import { PROMPT_ATTRS, redactPromptJson } from "./prompt-redaction";

export interface ContextSpanProcessorDeps {
	inputTokenPriceUsd?: number;
	outputTokenPriceUsd?: number;
}

/**
 * Copies our baggage keys onto every span, stamps `posthog.distinct_id` from
 * `member.id`, and for `ai.*` spans: redacts binary in the prompt attributes
 * (adr015 §6, delegated to prompt-redaction) and stamps token price attrs
 * (Decision 11).
 */
export class ContextSpanProcessor implements SpanProcessor {
	private readonly inputTokenPriceUsd?: number;
	private readonly outputTokenPriceUsd?: number;

	constructor(deps: ContextSpanProcessorDeps = {}) {
		this.inputTokenPriceUsd = deps.inputTokenPriceUsd;
		this.outputTokenPriceUsd = deps.outputTokenPriceUsd;
	}

	onStart(span: Span, parentContext: Context): void {
		this.stampBaggage(span, parentContext);
		if (span.name.startsWith("ai.")) {
			this.redactPrompt(span);
			this.stampTokenPrices(span);
		}
	}

	private stampBaggage(span: Span, parentContext: Context): void {
		const bag = readBaggage(parentContext);
		for (const [key, value] of Object.entries(bag)) {
			// Don't clobber a typed attribute set at span start (e.g. a numeric
			// receipt.id) with the baggage string copy — keeps a key's type stable
			// across spans so PostHog filters don't split.
			if (span.attributes[key] === undefined) {
				span.setAttribute(key, value);
			}
		}
		const memberId = bag[BaggageKey.MemberId];
		if (memberId && span.attributes["posthog.distinct_id"] === undefined) {
			span.setAttribute("posthog.distinct_id", memberId);
		}
	}

	private redactPrompt(span: Span): void {
		for (const attr of PROMPT_ATTRS) {
			const raw = span.attributes[attr];
			if (typeof raw !== "string") continue;
			const redacted = redactPromptJson(raw);
			if (redacted !== raw) span.setAttribute(attr, redacted);
		}
	}

	private stampTokenPrices(span: Span): void {
		if (this.inputTokenPriceUsd !== undefined) {
			span.setAttribute("$ai_input_token_price", this.inputTokenPriceUsd);
		}
		if (this.outputTokenPriceUsd !== undefined) {
			span.setAttribute("$ai_output_token_price", this.outputTokenPriceUsd);
		}
	}

	onEnd(_span: ReadableSpan): void {}

	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}
