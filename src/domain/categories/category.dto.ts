import { z } from "zod";

const categoryFields = {
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
};

export const categoryCreateDto = z.object({
	...categoryFields,
});

export const categoryUpdateDto = z.object({
	...categoryFields,
	id: z.number(),
});

// Ordered category ids; server derives sortOrder from array position.
export const categoryReorderDto = z.object({
	ids: z.array(z.number().int()).min(1),
});
