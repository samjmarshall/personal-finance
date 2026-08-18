import { z } from "zod";

// Shared field shapes carry NO default. Create applies defaults; update makes
// the same fields optional, so an omitted field stays untouched (Drizzle .set()
// skips undefined) instead of being reset to a default on a partial update.
const incomeFields = {
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
	fortnight: z.number().nonnegative(),
	month: z.number().nonnegative(),
	year: z.number().nonnegative(),
};

export const incomeCreateDto = z.object({
	...incomeFields,
	fortnight: incomeFields.fortnight.default(0),
	month: incomeFields.month.default(0),
	year: incomeFields.year.default(0),
});

export const incomeUpdateDto = z.object({
	...incomeFields,
	fortnight: incomeFields.fortnight.optional(),
	month: incomeFields.month.optional(),
	year: incomeFields.year.optional(),
	id: z.number(),
});
