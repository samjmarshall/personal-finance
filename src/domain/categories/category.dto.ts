import { z } from "zod";

export const categoryCreateDto = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	sortOrder: z.number().int().default(0),
});

export const categoryUpdateDto = z.object(categoryCreateDto.shape).extend({
	id: z.number(),
});
