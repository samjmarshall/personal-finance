import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { receiptCreateDto } from "./receipt.dto";
import type { Receipt } from "./receipt.interface";

// The client sends blob coordinates only; the server sets userId/status/channel.
// The contract is that the DTO plus those server-set fields writes into Receipt.
type ServerSet = {
	userId: string;
	status: ReceiptStatus;
	channel: ReceiptChannel;
};
type Contracts = [
	Expect<WritesInto<z.infer<typeof receiptCreateDto> & ServerSet, Receipt>>,
];

const base = {
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
};

describe("receiptCreateDto", () => {
	it("accepts blob coordinates with a content type", () => {
		expect(receiptCreateDto.safeParse(base).success).toBe(true);
	});

	it("accepts an omitted content type (worker backfills it)", () => {
		expect(
			receiptCreateDto.safeParse({
				blobUrl: base.blobUrl,
				blobPathname: base.blobPathname,
			}).success,
		).toBe(true);
	});

	it("rejects a non-URL blobUrl", () => {
		expect(
			receiptCreateDto.safeParse({ ...base, blobUrl: "not-a-url" }).success,
		).toBe(false);
	});

	it("rejects an empty blobPathname", () => {
		expect(
			receiptCreateDto.safeParse({ ...base, blobPathname: "" }).success,
		).toBe(false);
	});

	// The image proxy feeds blobPathname straight to blob `get()`, which treats an
	// `https://` value as a foreign store URL — so a URL pathname is a stored-XSS vector.
	it("rejects a blobPathname that is an absolute URL", () => {
		expect(
			receiptCreateDto.safeParse({
				...base,
				blobPathname: "https://evil.blob.vercel-storage.com/x.html",
			}).success,
		).toBe(false);
	});

	it("rejects a blobPathname with a parent-directory traversal", () => {
		expect(
			receiptCreateDto.safeParse({ ...base, blobPathname: "../secret.png" })
				.success,
		).toBe(false);
	});

	it("keeps create writable into the Receipt interface", () => {
		const aligned: Contracts = [true];
		expect(aligned).toHaveLength(1);
	});
});
