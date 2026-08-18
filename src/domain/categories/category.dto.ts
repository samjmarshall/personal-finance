import { z } from "zod";

export const categoryCreate = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	sortOrder: z.number().int().default(0),
});

export const categoryUpdate = z.object(categoryCreate.shape).extend({
	id: z.number(),
});
