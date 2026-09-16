import { createHash } from "node:crypto";
import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { BAGGAGE_KEYS, readBaggage } from "./baggage";

export interface ContextSpanProcessorDeps {
	inputTokenPriceUsd?: number;
	outputTokenPriceUsd?: number;
}

// The AI SDK stamps the prompt on two attributes: `ai.prompt.messages` on the
// inner doGenerate span (a message array) and `ai.prompt` on the outer
// generate* span (an object `{ system, prompt, messages }`). Both can carry the
// raw receipt image, so both must be redacted on the plain OTLP export path.
const PROMPT_ATTRS = ["ai.prompt.messages", "ai.prompt"] as const;

// Content-part fields carrying binary in AI SDK v5: FilePart.data, ImagePart.image.
const BINARY_PART_FIELDS = ["data", "image"] as const;

/**
 * Copies our baggage keys onto every span, stamps `posthog.distinct_id` from
 * `member.id`, and for `ai.*` spans: redacts binary in the prompt attributes
 * (adr015 §6) and stamps token price attrs (Decision 11).
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
			// Don't clobber a typed attribute set at span start (e.g. a numeric
			// receipt.id) with the baggage string copy — keeps a key's type stable
			// across spans so PostHog filters don't split.
			if (span.attributes[key] === undefined) {
				span.setAttribute(key, value);
			}
		}
		const memberId = bag[BAGGAGE_KEYS.memberId];
		if (memberId && span.attributes["posthog.distinct_id"] === undefined) {
			span.setAttribute("posthog.distinct_id", memberId);
		}

		if (span.name.startsWith("ai.")) {
			for (const attr of PROMPT_ATTRS) {
				redactPromptAttr(span, attr);
			}
			if (this.inputTokenPriceUsd !== undefined) {
				span.setAttribute("$ai_input_token_price", this.inputTokenPriceUsd);
			}
			if (this.outputTokenPriceUsd !== undefined) {
				span.setAttribute("$ai_output_token_price", this.outputTokenPriceUsd);
			}
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

/** In-place redaction of binary content in one prompt attribute; never throws. */
function redactPromptAttr(span: Span, attr: string): void {
	const raw = span.attributes[attr];
	if (typeof raw !== "string") return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return; // Leave malformed JSON untouched.
	}

	// `ai.prompt.messages` is the message array itself; `ai.prompt` wraps it as
	// `{ system, prompt, messages }` — redact the array in either shape.
	if (Array.isArray(parsed)) {
		span.setAttribute(attr, JSON.stringify(parsed.map(redactMessage)));
		return;
	}
	if (isObject(parsed) && Array.isArray(parsed.messages)) {
		const next = { ...parsed, messages: parsed.messages.map(redactMessage) };
		span.setAttribute(attr, JSON.stringify(next));
	}
}

function redactMessage(msg: unknown): unknown {
	if (!isObject(msg)) return msg;
	const parts = msg.content;
	if (!Array.isArray(parts)) return msg;
	return { ...msg, content: parts.map(redactPart) };
}

/** Replaces any binary payload field on a content part with a compact stub. */
function redactPart(part: unknown): unknown {
	if (!isObject(part)) return part;
	let next = part;
	for (const field of BINARY_PART_FIELDS) {
		if (!(field in next)) continue;
		const stub = stubBinary(next[field], next.mediaType);
		if (stub !== null) next = { ...next, [field]: stub };
	}
	return next;
}

function isObject(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Compact stub for a binary payload, preserving size + identity so it stays well
 * under PostHog's 4 MB attribute cap. Returns null when `value` isn't binary
 * (e.g. an http(s) reference URL), leaving the field untouched.
 */
function stubBinary(value: unknown, mediaType: unknown): string | null {
	const bytes = toBytes(value);
	if (bytes === null) return null;
	const sha = createHash("sha256").update(bytes).digest("hex");
	const mt =
		typeof mediaType === "string" ? mediaType : "application/octet-stream";
	return `<redacted ${mt} ${bytes.byteLength} sha256:${sha}>`;
}

/**
 * Coerces a content-part payload to bytes, or null if it isn't binary. Covers
 * every shape a prompt attribute can hold after its JSON round-trip: base64 or
 * data-URL strings, a plain Uint8Array (`{ "0": n, ... }`), a Node Buffer
 * (`{ type: "Buffer", data: [...] }`), and a bare number array.
 */
function toBytes(value: unknown): Buffer | null {
	if (typeof value === "string") return bytesFromString(value);
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (Array.isArray(value)) return bytesFromNumbers(value);
	if (isObject(value)) {
		if (value.type === "Buffer" && Array.isArray(value.data)) {
			return bytesFromNumbers(value.data);
		}
		return bytesFromIndexObject(value);
	}
	return null;
}

function bytesFromString(str: string): Buffer | null {
	// An http(s) URL is a pointer, not the bytes — leave the reference intact.
	if (/^https?:\/\//i.test(str)) return null;
	// A data: URL carries the bytes inline after the base64 marker.
	const dataUrl = /^data:[^,]*;base64,(.*)$/is.exec(str);
	if (dataUrl?.[1] !== undefined) return Buffer.from(dataUrl[1], "base64");
	if (isBase64(str)) return Buffer.from(str, "base64");
	return null;
}

function bytesFromNumbers(arr: unknown[]): Buffer | null {
	if (arr.length === 0) return null;
	const out = new Uint8Array(arr.length);
	for (let i = 0; i < arr.length; i++) {
		const v = arr[i];
		if (typeof v !== "number" || v < 0 || v > 255) return null;
		out[i] = v;
	}
	return Buffer.from(out);
}

function bytesFromIndexObject(obj: Record<string, unknown>): Buffer | null {
	const keys = Object.keys(obj);
	if (keys.length === 0) return null;
	const out = new Uint8Array(keys.length);
	for (let i = 0; i < keys.length; i++) {
		const v = obj[String(i)];
		if (typeof v !== "number" || v < 0 || v > 255) return null;
		out[i] = v;
	}
	return Buffer.from(out);
}

// base64: a multiple of 4 chars from the base64 alphabet with 0-2 `=` pads.
function isBase64(str: string): boolean {
	return (
		str.length > 0 && str.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(str)
	);
}
