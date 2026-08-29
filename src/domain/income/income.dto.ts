import { z } from "zod";

// Amounts optional (no .default): create falls through to the DB column's
// .notNull().default(0); update omits them so .set() preserves stored values.
const incomeFields = {
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
	fortnight: z.number().nonnegative().optional(),
	month: z.number().nonnegative().optional(),
	year: z.number().nonnegative().optional(),
	sortOrder: z.number().int().nonnegative().optional(),
};

export const incomeCreateDto = z.object({
	...incomeFields,
});

export const incomeUpdateDto = z.object({
	...incomeFields,
	id: z.number(),
});
