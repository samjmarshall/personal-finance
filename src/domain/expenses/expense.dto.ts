import { z } from "zod";

// Shared field shapes carry NO default. Create applies defaults; update makes
// the same fields optional, so an omitted field stays untouched (Drizzle .set()
// skips undefined) instead of being reset to a default on a partial update.
const expenseFields = {
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	fortnight: z.number().nonnegative(),
	month: z.number().nonnegative(),
	year: z.number().nonnegative(),
};

const expenseCreateDto = z.object({
	...expenseFields,
	fortnight: expenseFields.fortnight.default(0),
	month: expenseFields.month.default(0),
	year: expenseFields.year.default(0),
});

const expenseUpdateDto = z.object({
	...expenseFields,
	fortnight: expenseFields.fortnight.optional(),
	month: expenseFields.month.optional(),
	year: expenseFields.year.optional(),
	id: z.number(),
});

export { expenseCreateDto, expenseUpdateDto };
