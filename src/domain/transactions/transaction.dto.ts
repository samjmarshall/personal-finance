import { z } from "zod";
import { FREQUENCIES, PRIORITIES } from "~/lib/constants";

export const transactionListQueryDto = z.object({
	search: z.string().optional(),
	priority: z.string().optional(),
	frequency: z.string().optional(),
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

export const transactionCreateDto = z.object({
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	// category stays free-text by design; frequency/priority are managed vocab
	category: z.string().min(1).default("Uncategorised"),
	frequency: z.enum(FREQUENCIES).default("One-off"),
	priority: z.enum(PRIORITIES).default("Nice to Have"),
	// default null so omitted == cleared: create and update coalesce identically
	notes: z.string().nullable().default(null),
	expenseId: z.number().int().nullable().default(null),
});

export const transactionUpdateDto = z
	.object(transactionCreateDto.shape)
	.extend({
		id: z.number(),
	});
