import { describe, expect, it } from "vitest";
import {
	buildExtractionContent,
	buildExtractionPrompt,
	receiptExtraction,
} from "./extraction";

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

describe("buildExtractionContent", () => {
	const prompt = "Extract the receipt.";
	const bytes = new TextEncoder().encode(
		"<html><body>Total $9.20</body></html>",
	);

	it("sends a PDF as a file part carrying its media type", () => {
		const content = buildExtractionContent({
			prompt,
			bytes,
			mediaType: "application/pdf",
		});
		expect(content).toEqual([
			{ type: "text", text: prompt },
			{ type: "file", data: bytes, mediaType: "application/pdf" },
		]);
	});

	it.each(["image/jpeg", "image/png", "image/heic"])(
		"sends %s as an image part",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toEqual([
				{ type: "text", text: prompt },
				{ type: "image", image: bytes },
			]);
		},
	);

	it.each(["text/html", "text/plain"])(
		"folds %s into a single text part and sends no image part",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toHaveLength(1);
			expect(content[0]?.type).toBe("text");
			// The markup is the payload, not an attachment: an image part here is the
			// regression this phase exists to prevent (the model would see noise).
			expect(content).not.toContainEqual(
				expect.objectContaining({ type: "image" }),
			);
			const [part] = content;
			expect(part?.type === "text" && part.text).toContain(
				"<html><body>Total $9.20</body></html>",
			);
			expect(part?.type === "text" && part.text).toContain(prompt);
		},
	);

	it("decodes html bytes as UTF-8 so non-ASCII vendor names survive", () => {
		const content = buildExtractionContent({
			prompt,
			bytes: new TextEncoder().encode("<p>Café Ubé — €12,50</p>"),
			mediaType: "text/html",
		});
		const [part] = content;
		expect(part?.type === "text" && part.text).toContain("Café Ubé — €12,50");
	});
});
