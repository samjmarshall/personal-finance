import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, receiptExtraction } from "./extraction";

const wellFormed = {
	vendor: "Corner Grocer",
	receiptDate: "2026-08-14",
	total: 23.47,
	currency: "USD",
	items: [
		{ name: "Milk", price: 3.99, quantity: 1, expenseCategoryId: 7 },
		{ name: "Bread", price: 2.5, quantity: 2, expenseCategoryId: null },
	],
};

describe("receiptExtraction", () => {
	it("parses a well-formed extraction", () => {
		expect(receiptExtraction.safeParse(wellFormed).success).toBe(true);
	});

	it("accepts a null expenseCategoryId (unknown category → null, never invented)", () => {
		const parsed = receiptExtraction.parse(wellFormed);
		expect(parsed.items[1]?.expenseCategoryId).toBeNull();
	});

	it("rejects a malformed extraction (non-numeric total)", () => {
		expect(
			receiptExtraction.safeParse({ ...wellFormed, total: "lots" }).success,
		).toBe(false);
	});

	it("rejects an item missing a price", () => {
		expect(
			receiptExtraction.safeParse({
				...wellFormed,
				items: [{ name: "Milk", quantity: 1, expenseCategoryId: null }],
			}).success,
		).toBe(false);
	});
});

describe("buildExtractionPrompt", () => {
	it("lists every category's id and name so the model prefills expenseCategoryId", () => {
		const prompt = buildExtractionPrompt([
			{ id: 7, name: "Groceries" },
			{ id: 9, name: "Household" },
		]);
		expect(prompt).toContain("7");
		expect(prompt).toContain("Groceries");
		expect(prompt).toContain("9");
		expect(prompt).toContain("Household");
	});
});
