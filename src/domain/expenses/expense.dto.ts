import { z } from "zod";

const expenseFields = {
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	fortnight: z.number().int().nonnegative().optional(),
	month: z.number().int().nonnegative().optional(),
	year: z.number().int().nonnegative().optional(),
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
