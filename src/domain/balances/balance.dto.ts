import { z } from "zod";

// amount is unsigned-free: a household balance can be overdrawn. asOf as z.date()
// follows the expectedDate precedent (src/domain/income/income.dto.ts) — seeded and
// submitted through toDateInput/fromDateInput in the form.
export const balanceSetDto = z.object({
	amount: z.number(),
	asOf: z.date(),
});

export type BalanceSetInput = z.infer<typeof balanceSetDto>;
