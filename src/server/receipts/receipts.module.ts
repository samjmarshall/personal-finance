import { receiptUploadPrefix } from "~/domain/receipts";
import { env } from "~/env";
import { membersService } from "~/server/auth/members.module";
import { VercelBlobStore } from "~/server/blob-store/blob-store";
import { VercelClientUploads } from "~/server/blob-store/client-uploads";
import { categoriesService } from "~/server/categories/categories.module";
import { db } from "~/server/db";
import { expensesService } from "~/server/expenses/expenses.module";
import { outboxService } from "~/server/outbox/outbox.module";
import { transactionsService } from "~/server/transactions/transactions.module";

import { DrizzleReceiptsRepository } from "./receipts.repository";
import { ReceiptsService } from "./receipts.service";

// One shared instance. Other roots import it; don't rebuild it.
export const receiptsService = new ReceiptsService({
	repository: new DrizzleReceiptsRepository({ db, outbox: outboxService }),
	members: membersService,
	transactions: transactionsService,
	expenses: expensesService,
	categories: categoriesService,
	blobStore: new VercelBlobStore({ prefix: env.BLOB_PATH_PREFIX }),
	uploads: new VercelClientUploads(),
	uploadPathPrefix: receiptUploadPrefix(env.BLOB_PATH_PREFIX),
	posthogUi: { uiHost: env.POSTHOG_UI_HOST, projectId: env.POSTHOG_PROJECT_ID },
});
