import { z } from "zod";
import { Frequency, Priority } from "~/lib/constants";

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

// Shared field shapes carry NO default. Create applies defaults; update makes
// the same fields optional, so an omitted field stays untouched (Drizzle .set()
// skips undefined) instead of being reset to a default on a partial update.
const transactionFields = {
	date: z.date(),
	description: z.string().min(1, "Description is required"),
	amount: z.number(),
	// category stays free-text by design; frequency/priority are managed vocab
	category: z.string().min(1),
	frequency: z.enum(Frequency),
	priority: z.enum(Priority),
	// nullable + optional, NOT default null: on update .set() skips undefined, so
	// an omitted field is preserved; explicit null clears. default null would wipe
	// the link on every partial update.
	notes: z.string().nullable().optional(),
	expenseId: z.number().int().nullable().optional(),
};

export const transactionCreateDto = z.object({
	...transactionFields,
	category: transactionFields.category.default("Uncategorised"),
	frequency: transactionFields.frequency.default(Frequency.OneOff),
	priority: transactionFields.priority.default(Priority.NiceToHave),
});

export const transactionUpdateDto = z.object({
	...transactionFields,
	category: transactionFields.category.optional(),
	frequency: transactionFields.frequency.optional(),
	priority: transactionFields.priority.optional(),
	id: z.number(),
});
