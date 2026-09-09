import { z } from "zod";

/**
 * The slice of Resend's `email.received` this domain reads. Re-declared rather than
 * taken from the SDK's `EmailReceivedEvent` because it crosses the network: the
 * controller parses an untrusted body against it, and an unexpected extra field
 * must not fail the parse.
 */
const inboundAttachmentSchema = z.object({
	id: z.string(),
	filename: z.string().nullish(),
	content_type: z.string().nullish(),
	content_disposition: z.string().nullish(),
	content_id: z.string().nullish(),
});

export const inboundEmailEventSchema = z.object({
	type: z.string(),
	data: z.object({
		email_id: z.string(),
		from: z.string(),
		attachments: z
			.array(inboundAttachmentSchema)
			.nullish()
			.transform((v) => v ?? []),
	}),
});

export type InboundEmailEvent = z.infer<typeof inboundEmailEventSchema>;
export type InboundAttachmentMeta = z.infer<typeof inboundAttachmentSchema>;
