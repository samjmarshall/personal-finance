import { z } from "zod";

// Shared field shapes carry NO default. Create applies defaults; update makes
// the same fields optional, so an omitted field stays untouched (Drizzle .set()
// skips undefined) instead of being reset to a default on a partial update.
const categoryFields = {
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	sortOrder: z.number().int(),
};

export const categoryCreateDto = z.object({
	...categoryFields,
	sortOrder: categoryFields.sortOrder.default(0),
});

export const categoryUpdateDto = z.object({
	...categoryFields,
	sortOrder: categoryFields.sortOrder.optional(),
	id: z.number(),
});
