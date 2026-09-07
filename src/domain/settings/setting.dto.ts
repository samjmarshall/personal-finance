import { z } from "zod";
import { fromDateInput } from "~/lib/utils";

// Validating through fromDateInput — the same parser the reader uses — is what stops
// a value being written that reads back as null, silently degrading the cash-flow
// grid to months. A bare regex would let "2026-02-30" through; this doesn't.
export const fortnightAnchorSetDto = z.object({
	value: z.string().refine((v) => fromDateInput(v) !== null, {
		message: "Enter a valid date",
	}),
});
