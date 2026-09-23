import { createHash } from "node:crypto";

// The AI SDK stamps the prompt on two attributes: `ai.prompt.messages` on the
// inner doGenerate span (a message array) and `ai.prompt` on the outer
// generate* span (an object `{ system, prompt, messages }`). Both can carry the
// raw receipt image, so both must be redacted on the plain OTLP export path.
export const PROMPT_ATTRS = ["ai.prompt.messages", "ai.prompt"] as const;

// Content-part fields carrying binary in AI SDK v5: FilePart.data, ImagePart.image.
const BINARY_PART_FIELDS = ["data", "image"] as const;

/**
 * Redacts binary content in one serialized prompt attribute (adr015 §6). Returns
 * the input unchanged when it isn't message JSON we can walk — a malformed string
 * or a shape without a messages array — so a caller re-sets only on a real change.
 * Never throws.
 */
export function redactPromptJson(raw: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return raw; // Leave malformed JSON untouched.
	}

	// `ai.prompt.messages` is the message array itself; `ai.prompt` wraps it as
	// `{ system, prompt, messages }` — redact the array in either shape.
	if (Array.isArray(parsed)) {
		return JSON.stringify(parsed.map(redactMessage));
	}
	if (isObject(parsed) && Array.isArray(parsed.messages)) {
		return JSON.stringify({
			...parsed,
			messages: parsed.messages.map(redactMessage),
		});
	}
	return raw;
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
