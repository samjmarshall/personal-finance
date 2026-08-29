import { z } from "zod";

// Amounts optional (no .default): create falls through to the DB column's
// .notNull().default(0); update omits them so .set() preserves stored values.
const expenseFields = {
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	fortnight: z.number().nonnegative().optional(),
	month: z.number().nonnegative().optional(),
	year: z.number().nonnegative().optional(),
	sortOrder: z.number().int().nonnegative().optional(),
};

const expenseCreateDto = z.object({
	...expenseFields,
});

const expenseUpdateDto = z.object({
	...expenseFields,
	id: z.number(),
});

export { expenseCreateDto, expenseUpdateDto };
