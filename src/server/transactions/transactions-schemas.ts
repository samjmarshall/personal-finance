import { z } from "zod";

export const transactionInput = z.object({
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	category: z.string().min(1).default("Uncategorised"),
	frequency: z.string().min(1).default("One-off"),
	priority: z.string().min(1).default("Nice to Have"),
	notes: z.string().nullable().optional(),
	expenseId: z.number().int().nullable().optional(),
});
