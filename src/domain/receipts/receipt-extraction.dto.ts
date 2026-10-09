import { z } from "zod";

export const receiptExtractionDto = z.object({
	vendor: z.string().describe("Merchant / store name"),
	receiptDate: z.string().describe("Purchase date as YYYY-MM-DD"),
	total: z.number().describe("Grand total actually paid"),
	currency: z.string().describe("ISO 4217 code, e.g. USD"),
	items: z
		.array(
			z.object({
				name: z.string().describe("Line-item name as printed on the receipt"),
				price: z.number().describe("Unit price in the receipt's currency"),
				quantity: z
					.number()
					.describe("Quantity bought; 1 when the receipt omits it"),
				categoryId: z
					.number()
					.nullable()
					.describe(
						"id of the best-matching category from the provided list, or null when none clearly fits. Never invent an id.",
					),
			}),
		)
		.describe("Every purchased line item on the receipt"),
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionDto>;
