import { z } from "zod";

export const incomeCreateDto = z.object({
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
	fortnight: z.number().nonnegative().default(0),
	month: z.number().nonnegative().default(0),
	year: z.number().nonnegative().default(0),
});

export const incomeUpdateDto = z.object(incomeCreateDto.shape).extend({
	id: z.number(),
});
