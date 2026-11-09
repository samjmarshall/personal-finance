import { db } from "~/server/db";
import { createRootLogger } from "~/server/observability/logging/logger";
import { outboxService } from "~/server/outbox/outbox.module";

import { DuplicateApplyService } from "./duplicate-apply.service";
import { DrizzleTransactionsRepository } from "./transactions.repository";

// One shared instance: tRPC starts an Apply, the worker runs it. Don't rebuild it.
export const duplicateApplyService = new DuplicateApplyService({
	repository: new DrizzleTransactionsRepository({ db, outbox: outboxService }),
	logger: createRootLogger().with({
		domain: "transactions",
		component: "apply",
	}),
});
