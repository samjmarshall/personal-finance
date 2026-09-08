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

	// Stage 5's upload path must not drift: the forwarded-email preamble is written
	// for markup, and on a photo it tells the model to read past a greeting that
	// isn't there. Nothing else pinned this, so a prompt edit went unnoticed once.
	it.each([undefined, "image/jpeg", "application/pdf"])(
		"omits the forwarded-email hint for %s",
		(mediaType) => {
			expect(
				buildExtractionPrompt([{ id: 7, name: "Groceries" }], mediaType),
			).not.toContain("forwarded e-receipt email");
		},
	);

	it.each(["text/html", "text/plain", "text/html; charset=utf-8"])(
		"includes the forwarded-email hint for %s",
		(mediaType) => {
			expect(
				buildExtractionPrompt([{ id: 7, name: "Groceries" }], mediaType),
			).toContain("forwarded e-receipt email");
		},
	);
});

describe("buildExtractionContent", () => {
	const prompt = "Extract the receipt.";
	const bytes = new TextEncoder().encode(
		"<html><body>Total $9.20</body></html>",
	);

	it.each(["application/pdf", "application/pdf; charset=binary"])(
		"sends %s as a file part carrying the bare media type",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toEqual([
				{ type: "text", text: prompt },
				{ type: "file", data: bytes, mediaType: "application/pdf" },
			]);
		},
	);

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

	// The charset form is what the worker actually sees: `mediaType` is the blob's raw
	// HTTP content-type header, not the bare string the producer stored on the row.
	it.each(["text/html", "text/plain", "text/html; charset=utf-8"])(
		"folds %s into a single text part and sends no image part",
		(mediaType) => {
			const content = buildExtractionContent({ prompt, bytes, mediaType });
			expect(content).toHaveLength(1);
			expect(content[0]?.type).toBe("text");
			// Guard: HTML as an image part reaches the model as noise, not text.
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
