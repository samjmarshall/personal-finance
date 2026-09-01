import { z } from "zod";
import { CommitmentKind } from "~/lib/constants";

// Amounts optional (no .default): create falls through to the DB column's
// .notNull().default(0); update omits them so .set() preserves stored values.
const incomeFields = {
	person: z.string().min(1, "Person is required"),
	source: z.string().min(1, "Source is required"),
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
			message: "A one-time income needs an amount.",
		});
	}
	if (value.expectedDate == null) {
		ctx.addIssue({
			code: "custom",
			path: ["expectedDate"],
			message: "A one-time income needs an expected date.",
		});
	}
}

export const incomeCreateDto = z
	.object({ ...incomeFields })
	.superRefine(requireOneTimeFigures);

// kind is required on update (create leaves it optional for the DB default): update
// is a full replace, and the one-time invariant above can only hold when it knows the
// row's kind — an omitted kind would let a partial body null a required figure (adr011).
export const incomeUpdateDto = z
	.object({ ...incomeFields, id: z.number(), kind: z.enum(CommitmentKind) })
	.superRefine(requireOneTimeFigures);
