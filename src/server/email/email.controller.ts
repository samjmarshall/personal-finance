import type { Resend } from "resend";
import { inboundEmailEventDto } from "~/domain/email";
import type { Logger } from "~/server/observability/logger";
import { withSpan } from "~/server/observability/tracer";
import type { EmailService } from "./email.service";

interface EmailControllerDeps {
	resend: Pick<Resend, "webhooks">;
	webhookSecret: string;
	service: EmailService;
	logger: Logger;
}

/**
 * Resend inbound webhook. Public and unauthenticated by necessity — the Svix
 * signature over the raw body is the only thing separating a real delivery from
 * anyone who knows the URL, so nothing reads the payload before it verifies.
 */
export class EmailController {
	private readonly resend: Pick<Resend, "webhooks">;
	private readonly webhookSecret: string;
	private readonly service: EmailService;
	private readonly logger: Logger;

	constructor({ resend, webhookSecret, service, logger }: EmailControllerDeps) {
		this.resend = resend;
		this.webhookSecret = webhookSecret;
		this.service = service;
		this.logger = logger;
	}

	async handle(request: Request): Promise<Response> {
		// Raw text, never `request.json()`: the signature covers the exact bytes sent,
		// and a re-serialised object is not those bytes.
		const payload = await request.text();

		const id = request.headers.get("svix-id");
		const timestamp = request.headers.get("svix-timestamp");
		const signature = request.headers.get("svix-signature");
		if (!id || !timestamp || !signature) return unauthorized();

		let verified: unknown;
		try {
			verified = this.resend.webhooks.verify({
				payload,
				headers: { id, timestamp, signature },
				webhookSecret: this.webhookSecret,
			});
		} catch {
			// Deliberately unlogged and undifferentiated: a caller must not learn whether
			// the secret, the timestamp window or the digest is what rejected them.
			return unauthorized();
		}

		// Trace root for the inbound event, opened only past verification: an
		// unauthenticated caller leaves no span, and none of the rejection noise does.
		return withSpan("email.inbound", {}, async (span) => {
			const parsed = inboundEmailEventDto.safeParse(verified);
			// Signed but unreadable. Retrying will not change the shape, so it is a 200.
			if (!parsed.success) return json({ status: "ignored" });

			span.setAttribute("email.event_type", parsed.data.type);
			// Resend delivers every subscribed event to one endpoint; the others are not
			// this route's business, and a non-200 would make Svix retry them forever.
			if (parsed.data.type !== "email.received")
				return json({ status: "ignored" });

			const emailId = parsed.data.data.email_id;
			span.setAttribute("email.id", emailId);

			// A genuine failure below is left to throw: a 5xx is what earns a Svix retry,
			// and an expiring download URL is worth retrying. A drop is a verdict, not a
			// failure — 200 so it is never redelivered.
			try {
				const result = await this.service.ingest(parsed.data);
				if (result.status === "ingested")
					span.setAttribute("receipt.ids", result.receiptIds);
				return json(result);
			} catch (error) {
				this.logger.error("inbound email failed", {
					error,
					"email.id": emailId,
				});
				throw error;
			}
		});
	}
}

const unauthorized = () => new Response("Unauthorized", { status: 401 });

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
	});
