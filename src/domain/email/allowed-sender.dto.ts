import { z } from "zod";

// Normalise before validating, not after: a member pasting from a mail client brings
// surrounding whitespace, and validating first would reject it instead of cleaning it.
// The normalised value is what the unique index and the webhook's lookup key compare on.
const allowedSenderCreateDto = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.pipe(z.email("Enter a valid email address")),
});

const allowedSenderRefDto = z.object({ id: z.number().int() });

export { allowedSenderCreateDto, allowedSenderRefDto };
