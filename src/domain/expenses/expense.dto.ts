import { z } from "zod";
import { CommitmentKind } from "~/lib/constants";

// Amounts optional (no .default): create falls through to the DB column's
// .notNull().default(0); update omits them so .set() preserves stored values.
const expenseFields = {
	name: z.string().min(1, "Name is required"),
	category: z.string().min(1, "Category is required"),
	kind: z.enum(CommitmentKind).optional(),
	fortnight: z.number().nonnegative().optional(),
	month: z.number().nonnegative().optional(),
	year: z.number().nonnegative().optional(),
	amount: z.number().nonnegative().nullable().optional(),
	expectedDate: z.date().nullable().optional(),
	dueDay: z.number().int().min(1).max(31).nullable().optional(),
	dueMonth: z.number().int().min(1).max(12).nullable().optional(),
	sortOrder: z.number().int().nonnegative().optional(),
};

// adr011: a one-time budget must carry both its amount and expectedDate. Enforced
// in Zod, not a DB CHECK, so the two nullable columns stay free for recurring rows.
type OneTimeShape = {
	kind?: CommitmentKind;
	amount?: number | null;
	expectedDate?: Date | null;
};
function requireOneTimeFigures(
	value: OneTimeShape,
	ctx: z.RefinementCtx,
): void {
	if (value.kind !== CommitmentKind.OneTime) return;
	if (value.amount == null) {
		ctx.addIssue({
			code: "custom",
			path: ["amount"],
			message: "A one-time expense needs an amount.",
		});
	}
	if (value.expectedDate == null) {
		ctx.addIssue({
			code: "custom",
			path: ["expectedDate"],
			message: "A one-time expense needs an expected date.",
		});
	}
}

const expenseCreateDto = z
	.object({ ...expenseFields })
	.superRefine(requireOneTimeFigures);

const expenseUpdateDto = z
	.object({ ...expenseFields, id: z.number() })
	.superRefine(requireOneTimeFigures);

export { expenseCreateDto, expenseUpdateDto };
