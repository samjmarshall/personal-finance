import { env } from "~/env";
import { bedrock } from "~/server/aws/bedrock";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { categoriesService } from "~/server/categories/categories.module";
import { CdrInngestController } from "~/server/cdr/cdr.inngest.controller";
import { HttpRedbarkClient } from "~/server/cdr/cdr.redbark";
import { DrizzleCdrRepository } from "~/server/cdr/cdr.repository";
import { CdrSyncService } from "~/server/cdr/cdr-sync.service";
import { db } from "~/server/db";
import { captureException } from "~/server/observability/errors/posthog";
import { createRootLogger } from "~/server/observability/logging/logger";
import { OutboxInngestController } from "~/server/outbox/outbox.inngest.controller";
import { outboxService } from "~/server/outbox/outbox.module";
import { DrizzleReceiptExtractionRepository } from "~/server/receipts/receipt-extraction.repository";
import { ReceiptExtractionService } from "~/server/receipts/receipt-extraction.service";
import { ReceiptsInngestController } from "~/server/receipts/receipts.inngest.controller";
import { transactionsService } from "~/server/transactions/transactions.module";

import { inngest } from "./client";

// Composition root: every tier built once with the real db + client. The route
// handler (src/app/api/inngest/route.ts) serves this array; Inngest discovers each
// function's cron/event triggers from it. The outbox and categories services are
// shared with other roots, so they come from their *.module.ts files rather than
// being built here (as is the transactions service).
const outboxController = new OutboxInngestController({
	inngest,
	service: outboxService,
});

const receiptExtractionService = new ReceiptExtractionService({
	repository: new DrizzleReceiptExtractionRepository({ db }),
	categories: categoriesService,
	blobStore: new VercelBlobStore({ prefix: env.BLOB_PATH_PREFIX }),
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

// An unset key builds no client, so the daily run is a logged no-op.
const cdrSyncService = new CdrSyncService({
	repository: new DrizzleCdrRepository({ db }),
	redbark: env.REDBARK_API_KEY
		? new HttpRedbarkClient({
				apiKey: env.REDBARK_API_KEY,
				baseUrl: env.REDBARK_API_URL,
			})
		: null,
	transactions: transactionsService,
	logger: createRootLogger().with({ domain: "cdr", component: "sync" }),
});
const cdrController = new CdrInngestController({
	inngest,
	service: cdrSyncService,
});

export const functions = [
	...outboxController.functions,
	...receiptsController.functions,
	...cdrController.functions,
];
