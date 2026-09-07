import { z } from "zod";

/** Claude model for receipt extraction; pinned so a model bump is a deliberate edit. */
export const RECEIPT_MODEL = "claude-sonnet-4-6";

// Schema stays flat with rules in `.describe()`: the Anthropic constrained decoder
// strips string/number/array constraints into the field description, so validators
// like `.min()`/`.regex()` wouldn't reach the model anyway (they still run client-side).
const receiptItemExtraction = z.object({
	name: z.string().describe("Line-item name as printed on the receipt"),
	price: z.number().describe("Unit price in the receipt's currency"),
	quantity: z.number().describe("Quantity bought; 1 when the receipt omits it"),
	expenseCategoryId: z
		.number()
		.nullable()
		.describe(
			"id of the best-matching category from the provided list, or null when none clearly fits. Never invent an id.",
		),
});

export const receiptExtraction = z.object({
	vendor: z.string().describe("Merchant / store name"),
	receiptDate: z.string().describe("Purchase date as YYYY-MM-DD"),
	total: z.number().describe("Grand total actually paid"),
	currency: z.string().describe("ISO 4217 code, e.g. USD"),
	items: z
		.array(receiptItemExtraction)
		.describe("Every purchased line item on the receipt"),
});

export type ReceiptExtraction = z.infer<typeof receiptExtraction>;

export interface ExtractionCategory {
	id: number;
	name: string;
}

/**
 * Prompt listing the household's categories by id so each item comes back with a
 * prefilled `expenseCategoryId`. The id/name list is the only allowed vocabulary —
 * the model must map to one of these or return null, never coin a new category.
 */
export function buildExtractionPrompt(
	categories: ExtractionCategory[],
): string {
	const list = categories.map((c) => `- ${c.id}: ${c.name}`).join("\n");
	return `Extract the receipt's vendor, date (YYYY-MM-DD), grand total, currency, and every line item (name, price, quantity).

For each item, set expenseCategoryId to the id of the single best-matching category below, or null when none clearly fits. Only use an id from this list — never invent one:
${list}`;
}
