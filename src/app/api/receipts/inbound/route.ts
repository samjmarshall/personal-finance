import { Resend } from "resend";

import { env } from "~/env";
import { allowedSendersService } from "~/server/allowed-senders/allowed-senders.module";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { EmailHttpController } from "~/server/email/email.http.controller";
import { ResendInboundMailbox } from "~/server/email/email.mailbox";
import { EmailService } from "~/server/email/email.service";
import { createRootLogger } from "~/server/observability/logging/logger";
import { withFlush } from "~/server/observability/sdk/flush";
import { receiptsService } from "~/server/receipts/receipts.module";

const rootLogger = createRootLogger().with({ domain: "email" });

// Attachment bytes are fetched and blobbed inline, because the download URLs
// expire and the frozen `{ receiptId }` payload needs its row to exist before the
// event fires. A mail with several large PDFs can outrun the default budget.
export const maxDuration = 60;

// Composition root for the inbound-email tiers. Built on first request, not at
// module scope: `new Resend(undefined)` throws, and the build's page-data
// collection imports this file with no key in the env.
let controller: EmailHttpController | null = null;

function compose(apiKey: string, webhookSecret: string): EmailHttpController {
	if (controller) return controller;
	const resend = new Resend(apiKey);
	controller = new EmailHttpController({
		resend,
		webhookSecret,
		service: new EmailService({
			allowedSenders: allowedSendersService,
			receipts: receiptsService,
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
