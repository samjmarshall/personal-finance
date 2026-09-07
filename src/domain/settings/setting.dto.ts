import { z } from "zod";
import { fromDateInput } from "~/lib/utils";

// Two guards, both needed. The regex pins the padded shape <input type="date">
// requires — fromDateInput alone accepts "2026-8-12" and " 2026-08-12", which the
// chart parses fine but the input renders blank, so the form re-saves a value the
// user can't see. The refine then rejects "2026-02-30", which the regex can't.
export const fortnightAnchorSetDto = z.object({
	anchor: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
		.refine((v) => fromDateInput(v) !== null, {
			message: "Enter a valid date",
		}),
});
