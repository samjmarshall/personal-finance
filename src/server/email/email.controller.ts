import type { Resend } from "resend";

import { inboundEmailEventSchema } from "./email.dto";
import type { EmailService } from "./email.service";

interface EmailControllerDeps {
	resend: Pick<Resend, "webhooks">;
	webhookSecret: string;
	service: EmailService;
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

	constructor({ resend, webhookSecret, service }: EmailControllerDeps) {
		this.resend = resend;
		this.webhookSecret = webhookSecret;
		this.service = service;
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

		const parsed = inboundEmailEventSchema.safeParse(verified);
		// Signed but unreadable. Retrying will not change the shape, so it is a 200.
		if (!parsed.success) return json({ status: "ignored" });

		// Resend delivers every subscribed event to one endpoint; the others are not
		// this route's business, and a non-200 would make Svix retry them forever.
		if (parsed.data.type !== "email.received")
			return json({ status: "ignored" });

		// A genuine failure below is left to throw: a 5xx is what earns a Svix retry,
		// and an expiring download URL is worth retrying. A drop is a verdict, not a
		// failure — 200 so it is never redelivered.
		return json(await this.service.ingest(parsed.data));
	}
}

const unauthorized = () => new Response("Unauthorized", { status: 401 });

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
	});
