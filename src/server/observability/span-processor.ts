import { createHash } from "node:crypto";
import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { readBaggage } from "./baggage";

export interface ContextSpanProcessorDeps {
	inputTokenPriceUsd?: number;
	outputTokenPriceUsd?: number;
}

/**
 * Copies our baggage keys onto every span, stamps `posthog.distinct_id` from
 * `member.id`, and for `ai.*` spans: redacts base64 binary in
 * `ai.prompt.messages` (adr015 §6) and stamps token price attrs (Decision 11).
 */
export class ContextSpanProcessor implements SpanProcessor {
	private readonly inputTokenPriceUsd?: number;
	private readonly outputTokenPriceUsd?: number;

	constructor(deps: ContextSpanProcessorDeps = {}) {
		this.inputTokenPriceUsd = deps.inputTokenPriceUsd;
		this.outputTokenPriceUsd = deps.outputTokenPriceUsd;
	}

	onStart(span: Span, parentContext: Context): void {
		const bag = readBaggage(parentContext);
		for (const [key, value] of Object.entries(bag)) {
			span.setAttribute(key, value);
		}
		if (bag["member.id"]) {
			span.setAttribute("posthog.distinct_id", bag["member.id"]);
		}

		if (span.name.startsWith("ai.")) {
			this.redactPromptMessages(span);
			if (this.inputTokenPriceUsd !== undefined) {
				span.setAttribute("$ai_input_token_price", this.inputTokenPriceUsd);
			}
			if (this.outputTokenPriceUsd !== undefined) {
				span.setAttribute("$ai_output_token_price", this.outputTokenPriceUsd);
			}
		}
	}

	/** In-place redaction of base64 binary in ai.prompt.messages; never throws. */
	private redactPromptMessages(span: Span): void {
		const raw = span.attributes["ai.prompt.messages"];
		if (typeof raw !== "string") return;

		let messages: unknown;
		try {
			messages = JSON.parse(raw);
		} catch {
			return; // Leave malformed JSON untouched.
		}

		if (!Array.isArray(messages)) return;

		const redacted = messages.map((msg: unknown) => {
			if (!isObject(msg)) return msg;
			const parts = msg.content;
			if (!Array.isArray(parts)) return msg;
			return {
				...msg,
				content: parts.map((part: unknown) => {
					if (!isObject(part)) return part;
					const { type, data, mediaType } = part as {
						type?: unknown;
						data?: unknown;
						mediaType?: unknown;
					};
					if (
						(type === "file" || type === "image") &&
						typeof data === "string"
					) {
						return { ...part, data: stubBase64(data, mediaType) };
					}
					return part;
				}),
			};
		});

		span.setAttribute("ai.prompt.messages", JSON.stringify(redacted));
	}

	onEnd(_span: ReadableSpan): void {}

	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}
}

function isObject(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Replaces base64-encoded binary with a compact stub preserving size and
 * identity — keeps the payload well under PostHog's 4 MB attribute cap.
 */
function stubBase64(b64: string, mediaType: unknown): string {
	const bytes = Buffer.from(b64, "base64");
	const sha = createHash("sha256").update(bytes).digest("hex");
	const mt =
		typeof mediaType === "string" ? mediaType : "application/octet-stream";
	return `<redacted ${mt} ${bytes.byteLength} sha256:${sha}>`;
}
