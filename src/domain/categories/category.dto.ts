import { z } from "zod";

const categoryFields = {
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	sortOrder: z.number().int().nonnegative().optional(),
};

export const categoryCreateDto = z.object({
	...categoryFields,
});

export const categoryUpdateDto = z.object({
	...categoryFields,
	id: z.number(),
});
