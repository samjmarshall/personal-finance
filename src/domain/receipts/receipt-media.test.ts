import { describe, expect, it } from "vitest";

import { RECEIPT_FILE_TYPES, receiptMediaKind } from "./receipt-media";

describe("receiptMediaKind", () => {
	it.each([
		["image/jpeg", "image"],
		["image/png", "image"],
		["application/pdf", "pdf"],
		["text/html", "text"],
		["text/plain", "text"],
		// Stored headers can carry params and any case; the kind must still match.
		["Text/HTML; charset=utf-8", "text"],
		["image/gif", null],
		[undefined, null],
	])("%s → %s", (type, kind) => {
		expect(receiptMediaKind(type)).toBe(kind);
	});
});

describe("RECEIPT_FILE_TYPES", () => {
	// The email body is text, but a member can't send a text file as a receipt.
	it("lists only file kinds, never text", () => {
		expect(RECEIPT_FILE_TYPES).toEqual([
			"image/jpeg",
			"image/png",
			"application/pdf",
		]);
	});
});
