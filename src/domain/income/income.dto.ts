import { z } from "zod";

const incomeFields = {
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
	fortnight: z.number().int().nonnegative().optional(),
	month: z.number().int().nonnegative().optional(),
	year: z.number().int().nonnegative().optional(),
	sortOrder: z.number().int().nonnegative().optional(),
};

export const incomeCreateDto = z.object({
	...incomeFields,
});

export const incomeUpdateDto = z.object({
	...incomeFields,
	id: z.number(),
});
