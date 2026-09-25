import { Resend } from "resend";

import { env } from "~/env";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { db } from "~/server/db";
import { EmailController } from "~/server/email/email.controller";
import { ResendInboundMailbox } from "~/server/email/email.mailbox";
import { DrizzleEmailRepository } from "~/server/email/email.repository";
import { EmailService } from "~/server/email/email.service";
import { withFlush } from "~/server/observability/flush";
import { createRootLogger } from "~/server/observability/logger";
import { outboxService } from "~/server/outbox/outbox.module";

const rootLogger = createRootLogger().with({ domain: "email" });

// Attachment bytes are fetched and blobbed inline, because the download URLs
// expire and the frozen `{ receiptId }` payload needs its row to exist before the
// event fires. A mail with several large PDFs can outrun the default budget.
export const maxDuration = 60;

// Composition root for the inbound-email tiers. Built on first request, not at
// module scope: `new Resend(undefined)` throws, and the build's page-data
// collection imports this file with no key in the env.
let controller: EmailController | null = null;

function compose(apiKey: string, webhookSecret: string): EmailController {
	if (controller) return controller;
	const resend = new Resend(apiKey);
	controller = new EmailController({
		resend,
		webhookSecret,
		service: new EmailService({
			repository: new DrizzleEmailRepository({
				db,
				outbox: outboxService,
			}),
			mailbox: new ResendInboundMailbox({ resend }),
			blobStore: new VercelBlobStore(),
			logger: rootLogger.with({ component: "service" }),
		}),
		logger: rootLogger.with({ component: "controller" }),
	});
	return controller;
}

export const POST = withFlush(async (request: Request): Promise<Response> => {
	// Both are optional outside production, so an unconfigured deployment would
	// otherwise verify against an empty secret. Refuse rather than define what
	// that means.
	const webhookSecret = env.RESEND_WEBHOOK_SECRET;
	const apiKey = env.RESEND_API_KEY;
	if (!webhookSecret || !apiKey) {
		rootLogger
			.with({ component: "route" })
			.error("Resend credentials are not configured", {
				"event.name": "email.route.unconfigured",
			});
		return new Response("Not configured", { status: 500 });
	}
	return compose(apiKey, webhookSecret).handle(request);
});
