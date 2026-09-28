import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { redactPromptJson } from "./prompt-redaction";

function makeMessages(parts: unknown[]) {
	return JSON.stringify([{ role: "user", content: parts }]);
}

function filePart(b64: string, mediaType = "image/jpeg") {
	return { type: "file", data: b64, mediaType };
}

function textPart(text: string) {
	return { type: "text", text };
}

describe("redactPromptJson", () => {
	it("redacts file parts; text parts are unchanged", () => {
		const bytes = Buffer.from("binary-image-content");
		const b64 = bytes.toString("base64");
		const sha = createHash("sha256").update(bytes).digest("hex");
		const messages = makeMessages([
			filePart(b64, "image/jpeg"),
			textPart("describe this"),
		]);

		const out = JSON.parse(redactPromptJson(messages));
		const parts: Array<{ type: string; data?: string; text?: string }> =
			out[0].content;

		expect(parts[0]?.data).toBe(
			`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
		);
		expect(parts[1]?.text).toBe("describe this");
	});

	// Forwarded e-receipts ride inline as text: member data, and up to 10 MB.
	it("stubs a text part over 8 KB (an inline e-receipt body)", () => {
		const body = `Extract the receipt.\n\n<html>${"x".repeat(10 * 1024)}</html>`;
		const bytes = Buffer.from(body, "utf8");
		const sha = createHash("sha256").update(bytes).digest("hex");

		const out = JSON.parse(redactPromptJson(makeMessages([textPart(body)])));

		expect(out[0].content[0]).toEqual({
			type: "text",
			text: `<redacted text/plain ${bytes.byteLength} sha256:${sha}>`,
		});
	});

	// A short e-receipt is still member data; the size cap alone would ship it raw.
	it("stubs a tagged text part at any size", () => {
		const body = "<p>Total $9.20</p>";
		const sha = createHash("sha256").update(body).digest("hex");
		const part = {
			...textPart(body),
			providerOptions: {
				observability: {
					redact: true,
				},
			},
		};

		const out = JSON.parse(redactPromptJson(makeMessages([part])));

		expect(out[0].content[0]).toEqual({
			...part,
			text: `<redacted text/plain ${Buffer.byteLength(body)} sha256:${sha}>`,
		});
	});

	it("keeps a text part at exactly 8 KB", () => {
		const text = "a".repeat(8 * 1024);

		const out = JSON.parse(redactPromptJson(makeMessages([textPart(text)])));

		expect(out[0].content[0].text).toBe(text);
	});

	it("reduces a 3 MB base64 file part to a stub under 200 bytes", () => {
		const bigBytes = Buffer.alloc(3 * 1024 * 1024, 0xab);
		const messages = makeMessages([filePart(bigBytes.toString("base64"))]);

		const out = JSON.parse(redactPromptJson(messages));
		const stub: string = out[0].content[0].data;

		expect(stub.startsWith("<redacted")).toBe(true);
		expect(Buffer.byteLength(stub, "utf8")).toBeLessThan(200);
	});

	it("handles image type parts as well as file type parts", () => {
		const bytes = Buffer.from("raw-image");
		const b64 = bytes.toString("base64");
		const sha = createHash("sha256").update(bytes).digest("hex");
		const messages = makeMessages([
			{ type: "image", data: b64, mediaType: "image/png" },
		]);

		const out = JSON.parse(redactPromptJson(messages));
		expect(out[0].content[0].data).toBe(
			`<redacted image/png ${bytes.byteLength} sha256:${sha}>`,
		);
	});

	it("leaves unparsable JSON untouched", () => {
		const bad = "not valid json {{{";
		expect(redactPromptJson(bad)).toBe(bad);
	});

	it("falls back to application/octet-stream when mediaType is absent", () => {
		const bytes = Buffer.from("data");
		const b64 = bytes.toString("base64");
		const sha = createHash("sha256").update(bytes).digest("hex");
		const messages = makeMessages([{ type: "file", data: b64 }]);

		const out = JSON.parse(redactPromptJson(messages));
		expect(out[0].content[0].data).toBe(
			`<redacted application/octet-stream ${bytes.byteLength} sha256:${sha}>`,
		);
	});

	it("redacts an image part carrying raw Uint8Array bytes (receipts shape)", () => {
		// receipts.service.ts emits { type: "image", image: <Uint8Array> }, which
		// serializes to a numeric-keyed object — not a base64 string.
		const bytes = new Uint8Array(Buffer.from("raw-receipt-jpeg-bytes"));
		const sha = createHash("sha256").update(bytes).digest("hex");
		const messages = makeMessages([
			{ type: "image", image: bytes, mediaType: "image/jpeg" },
		]);

		const out = JSON.parse(redactPromptJson(messages));
		expect(out[0].content[0].image).toBe(
			`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
		);
	});

	it("redacts a Node Buffer-shaped payload ({ type: 'Buffer', data })", () => {
		const buf = Buffer.from("node-buffer-pdf-bytes");
		const sha = createHash("sha256").update(buf).digest("hex");
		const messages = makeMessages([
			{ type: "file", data: buf, mediaType: "application/pdf" },
		]);

		const out = JSON.parse(redactPromptJson(messages));
		expect(out[0].content[0].data).toBe(
			`<redacted application/pdf ${buf.byteLength} sha256:${sha}>`,
		);
	});

	it("redacts binary in the outer ai.prompt object shape", () => {
		// The generate* outer span wraps messages in { system, prompt, messages }
		// under `ai.prompt` — a separate leak path from `ai.prompt.messages`.
		const bytes = new Uint8Array(Buffer.from("outer-span-receipt-bytes"));
		const sha = createHash("sha256").update(bytes).digest("hex");
		const prompt = JSON.stringify({
			system: "extract the receipt",
			messages: [
				{
					role: "user",
					content: [
						{ type: "image", image: bytes, mediaType: "image/jpeg" },
						textPart("extract"),
					],
				},
			],
		});

		const out = JSON.parse(redactPromptJson(prompt));
		expect(out.messages[0].content[0].image).toBe(
			`<redacted image/jpeg ${bytes.byteLength} sha256:${sha}>`,
		);
		expect(out.messages[0].content[1].text).toBe("extract");
		expect(out.system).toBe("extract the receipt");
	});

	it("leaves an http reference URL untouched (not decoded as base64)", () => {
		const url = "https://blob.example/receipt.jpg";
		const messages = makeMessages([
			{ type: "image", image: url, mediaType: "image/jpeg" },
		]);

		const out = JSON.parse(redactPromptJson(messages));
		expect(out[0].content[0].image).toBe(url);
	});
});
