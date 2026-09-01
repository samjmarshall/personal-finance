import { z } from "zod";

// periodKind mirrors PeriodKind (src/lib/period.ts) — a parallel literal list kept
// in sync by hand, since PeriodKind is a type union, not an enum.
export const cashflowQueryDto = z.object({
	periodKind: z.enum(["fortnight", "month"]).default("fortnight"),
});
