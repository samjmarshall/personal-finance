import { z } from "zod";

const expenseCreateDto = z.object({
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	fortnight: z.number().nonnegative().default(0),
	month: z.number().nonnegative().default(0),
	year: z.number().nonnegative().default(0),
});

const expenseUpdateDto = z.object(expenseCreateDto.shape).extend({
	id: z.number(),
});

export { expenseCreateDto, expenseUpdateDto };
