import { z } from "zod";
import { Frequency, Priority } from "~/lib/constants";

export const transactionListQueryDto = z.object({
	search: z.string().optional(),
	priority: z.enum(Priority).optional(),
	frequency: z.enum(Frequency).optional(),
	category: z.string().optional(),
	from: z.date().optional(),
	to: z.date().optional(),
	sortBy: z
		.enum(["date", "description", "amount", "category", "priority"])
		.default("date"),
	sortDir: z.enum(["asc", "desc"]).default("desc"),
	limit: z.number().min(1).max(200).default(50),
	offset: z.number().min(0).default(0),
});

const transactionFields = {
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	category: z.string().optional(),
	frequency: z.enum(Frequency).optional(),
	priority: z.enum(Priority).optional(),
	notes: z.string().nullable().optional(),
	expenseId: z.number().int().nonnegative().nullable().optional(),
};

export const transactionCreateDto = z.object({
	...transactionFields,
});

export const transactionUpdateDto = z.object({
	...transactionFields,
	id: z.number(),
});
