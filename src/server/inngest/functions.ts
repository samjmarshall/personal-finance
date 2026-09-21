import { env } from "~/env";
import { bedrock } from "~/server/aws/bedrock";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { db } from "~/server/db";
import { createRootLogger } from "~/server/observability/logger";
import { captureException } from "~/server/observability/posthog";
import { OutboxController } from "~/server/outbox/outbox.controller";
import { outboxService } from "~/server/outbox/outbox.module";
import { ReceiptsController } from "~/server/receipts/receipts.controller";
import { DrizzleReceiptsRepository } from "~/server/receipts/receipts.repository";
import { ReceiptsService } from "~/server/receipts/receipts.service";

import { inngest } from "./client";

// Composition root: every tier built once with the real db + client. The route
// handler (src/app/api/inngest/route.ts) serves this array; Inngest discovers each
// function's cron/event triggers from it. The outbox service is shared with the
// write-door callers, so it comes from outbox.module.ts rather than being built here.
const outboxController = new OutboxController({
	inngest,
	service: outboxService,
});

const receiptsService = new ReceiptsService({
	repository: new DrizzleReceiptsRepository({ db }),
	blobStore: new VercelBlobStore(),
	// The only place the receipts tier is bound to Bedrock; the service stays
	// provider-agnostic behind `languageModel` (bedrock-invocation.md).
	languageModel: bedrock(env.BEDROCK_RECEIPT_MODEL),
	logger: createRootLogger().with({ domain: "receipts", component: "service" }),
	errorReporter: { captureException },
});
const receiptsController = new ReceiptsController({
	inngest,
	service: receiptsService,
});

export const functions = [
	...outboxController.functions,
	...receiptsController.functions,
];
