import type { FilePart, ImagePart, TextPart } from "ai";
import { z } from "zod";
import { bareMediaType, isPdf, isText } from "~/lib/utils";

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

// Only the email Channel sends markup, so only it gets this. A photo upload has no
// greeting or footer to read past, and the vendor warning would be nonsense there.
const FORWARDED_EMAIL_HINT = `The payload is a forwarded e-receipt email rather than a photo of a receipt. Read past the greeting, forwarding headers, promotions and footer to the order lines, and treat the merchant that issued the order as the vendor — never the mail provider or the person who forwarded it.

`;

/**
 * Prompt listing the household's categories by id so each item comes back with a
 * prefilled `expenseCategoryId`. The id/name list is the only allowed vocabulary —
 * the model must map to one of these or return null, never coin a new category.
 * `mediaType` only selects the forwarded-email preamble; it never changes the schema.
 */
export function buildExtractionPrompt(
	categories: ExtractionCategory[],
	mediaType?: string,
): string {
	const list = categories.map((c) => `- ${c.id}: ${c.name}`).join("\n");
	const hint = isText(mediaType) ? FORWARDED_EMAIL_HINT : "";
	return `Extract the receipt's vendor, date (YYYY-MM-DD), grand total, currency, and every line item (name, price, quantity).

${hint}For each item, set expenseCategoryId to the id of the single best-matching category below, or null when none clearly fits. Only use an id from this list — never invent one:
${list}`;
}

/**
 * AI-SDK user content for one receipt, routed by media type. A text body returns a
 * *single* part — prompt and markup merged; PDF/image return prompt + payload part.
 */
export function buildExtractionContent({
	prompt,
	bytes,
	mediaType,
}: {
	prompt: string;
	bytes: Uint8Array;
	mediaType: string;
}): Array<TextPart | ImagePart | FilePart> {
	// Markup sent as an image part reaches the model as unreadable noise; inline it.
	// Untrusted third-party HTML — never render it in the browser.
	if (isText(mediaType)) {
		return [
			{
				type: "text",
				text: `${prompt}\n\n${new TextDecoder().decode(bytes)}`,
			},
		];
	}
	return [
		{ type: "text", text: prompt },
		isPdf(mediaType)
			? // Bare type, not the blob's raw header: Anthropic rejects a file part whose
				// media type carries parameters.
				{ type: "file", data: bytes, mediaType: bareMediaType(mediaType) }
			: { type: "image", image: bytes },
	];
}
