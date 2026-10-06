import { z } from "zod";

const categoryFields = {
	name: z.string().trim().min(1, "Name is required"),
	description: z.string().optional(),
};

export const categoryCreateDto = z.object({
	...categoryFields,
});

export type CategoryCreateInput = z.infer<typeof categoryCreateDto>;

export const categoryUpdateDto = z.object({
	...categoryFields,
	id: z.number(),
});

export type CategoryUpdateInput = z.infer<typeof categoryUpdateDto>;

// Ordered category ids; server derives sortOrder from array position.
export const categoryReorderDto = z.object({
	ids: z.array(z.number().int()).min(1),
});

export type CategoryReorderInput = z.infer<typeof categoryReorderDto>;
