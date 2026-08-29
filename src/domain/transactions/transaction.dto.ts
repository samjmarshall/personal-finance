import { z } from "zod";
import { Frequency, Priority } from "~/lib/constants";
import type { Transaction } from "./transaction.interface";

// sortBy values must be real Transaction fields; `satisfies` makes tsc reject a
// typo or non-field here. It preserves the literal tuple, so z.enum keeps its
// narrow union and the router can key a column map off it.
export const transactionSortBy = z.enum([
	"date",
	"description",
	"amount",
	"category",
	"priority",
] satisfies readonly (keyof Transaction)[]);

export const transactionListQueryDto = z.object({
	search: z.string().optional(),
	priority: z.enum(Priority).optional(),
	frequency: z.enum(Frequency).optional(),
	category: z.string().optional(),
	from: z.date().optional(),
	to: z.date().optional(),
	sortBy: transactionSortBy.default("date"),
	sortDir: z.enum(["asc", "desc"]).default("desc"),
	limit: z.number().min(1).max(200).default(50),
	offset: z.number().min(0).default(0),
});

const transactionFields = {
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	category: z.string().trim().min(1, "Category is required").optional(),
	frequency: z.enum(Frequency).optional(),
	priority: z.enum(Priority).optional(),
	notes: z.string().nullable().optional(),
	expenseId: z.number().int().positive().nullable().optional(),
	expenseCategoryId: z.number().int().positive().nullable().optional(),
};

export const transactionCreateDto = z.object({
	...transactionFields,
});

export const transactionUpdateDto = z.object({
	...transactionFields,
	id: z.number(),
});

// Unplanned = unlinked Spend in a half-open [from, to) window (adr010). Reject an
// inverted window up front so a bad range surfaces instead of silently matching
// nothing.
export const unplannedDto = z
	.object({
		from: z.date(),
		to: z.date(),
	})
	.refine((w) => w.from <= w.to, {
		message: "`from` must be on or before `to`.",
	});

// expenseId required, not optional: linking sets an int, clearing passes null
// explicitly — an omitted value would be an ambiguous no-op. Positive ints only,
// matching every other transaction FK.
export const linkExpenseDto = z.object({
	id: z.number().int().positive(),
	expenseId: z.number().int().positive().nullable(),
});
