import { describe, expect, it } from "vitest";

import {
	isReceiptFileType,
	RECEIPT_FILE_TYPES,
	receiptMediaKind,
	receiptUploadPrefix,
} from "./receipt-media";

describe("receiptMediaKind", () => {
	it.each([
		["image/jpeg", "image"],
		["image/png", "image"],
		["application/pdf", "pdf"],
		["text/html", "text"],
		["text/plain", "text"],
		// Stored headers can carry params and any case; the kind must still match.
		["Text/HTML; charset=utf-8", "text"],
		["text/plain;charset=UTF-8", "text"],
		["  APPLICATION/PDF  ", "pdf"],
		["application/pdf; charset=binary", "pdf"],
		["image/gif", null],
		["", null],
		[null, null],
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

describe("isReceiptFileType", () => {
	it.each([
		["image/jpeg", true],
		["Application/PDF; name=r.pdf", true],
		["text/html", false],
		["image/gif", false],
		[null, false],
	])("%s → %s", (type, ok) => {
		expect(isReceiptFileType(type)).toBe(ok);
	});
});

describe("receiptUploadPrefix", () => {
	it.each([
		["", "receipts/upload/"],
		["local/b/", "local/b/receipts/upload/"],
	])("puts uploads for %j under %j", (blobPathPrefix, expected) => {
		expect(receiptUploadPrefix(blobPathPrefix)).toBe(expected);
	});
});
