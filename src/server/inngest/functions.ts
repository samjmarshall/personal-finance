import { env } from "~/env";
import { bedrock } from "~/server/aws/bedrock";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { db } from "~/server/db";
import { captureException } from "~/server/observability/errors/posthog";
import { createRootLogger } from "~/server/observability/logging/logger";
import { OutboxInngestController } from "~/server/outbox/outbox.inngest.controller";
import { outboxService } from "~/server/outbox/outbox.module";
import { DrizzleReceiptExtractionRepository } from "~/server/receipts/receipt-extraction.repository";
import { ReceiptExtractionService } from "~/server/receipts/receipt-extraction.service";
import { ReceiptsInngestController } from "~/server/receipts/receipts.inngest.controller";

import { inngest } from "./client";

// Composition root: every tier built once with the real db + client. The route
// handler (src/app/api/inngest/route.ts) serves this array; Inngest discovers each
// function's cron/event triggers from it. The outbox service is shared with the
// write-door callers, so it comes from outbox.module.ts rather than being built here.
const outboxController = new OutboxInngestController({
	inngest,
	service: outboxService,
});

const receiptExtractionService = new ReceiptExtractionService({
	repository: new DrizzleReceiptExtractionRepository({ db }),
	blobStore: new VercelBlobStore(),
	// The only place the receipts tier is bound to Bedrock; the service stays
	// provider-agnostic behind `languageModel` (bedrock-invocation.md).
	languageModel: bedrock(env.BEDROCK_RECEIPT_MODEL),
	logger: createRootLogger().with({ domain: "receipts", component: "service" }),
	errorReporter: { captureException },
});
const receiptsController = new ReceiptsInngestController({
	inngest,
	service: receiptExtractionService,
});

export const functions = [
	...outboxController.functions,
	...receiptsController.functions,
];
