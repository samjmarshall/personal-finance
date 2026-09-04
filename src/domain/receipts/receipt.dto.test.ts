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

	it("keeps create writable into the Receipt interface", () => {
		const aligned: Contracts = [true];
		expect(aligned).toHaveLength(1);
	});
});
