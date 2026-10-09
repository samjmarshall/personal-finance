import { describe, expect, it } from "vitest";
import { receiptExtractionDto } from "./receipt-extraction.dto";

const wellFormed = {
	vendor: "Corner Grocer",
	receiptDate: "2026-08-14",
	total: 23.47,
	currency: "USD",
	items: [
		{ name: "Milk", price: 3.99, quantity: 1, categoryId: 7 },
		{ name: "Bread", price: 2.5, quantity: 2, categoryId: null },
	],
};

describe("receiptExtractionDto", () => {
	it("parses a well-formed extraction", () => {
		expect(receiptExtractionDto.safeParse(wellFormed).success).toBe(true);
	});

	it("accepts a null categoryId (unknown category → null, never invented)", () => {
		const parsed = receiptExtractionDto.parse(wellFormed);
		expect(parsed.items[1]?.categoryId).toBeNull();
	});

	it("rejects a malformed extraction (non-numeric total)", () => {
		expect(
			receiptExtractionDto.safeParse({ ...wellFormed, total: "lots" }).success,
		).toBe(false);
	});

	it("rejects an item missing a price", () => {
		expect(
			receiptExtractionDto.safeParse({
				...wellFormed,
				items: [{ name: "Milk", quantity: 1, categoryId: null }],
			}).success,
		).toBe(false);
	});
});
