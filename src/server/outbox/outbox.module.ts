import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";
import { createRootLogger } from "~/server/observability/logging/logger";

import { DrizzleOutboxRepository } from "./outbox.repository";
import { OutboxService } from "./outbox.service";

// Module surface `{ service }` (adr004): one instance shared by `receipts.module.ts`
// (its repository's write door) and the cron controller built in
// src/server/inngest/functions.ts.
export const outboxService = new OutboxService({
	repository: new DrizzleOutboxRepository({ db }),
	inngest,
	logger: createRootLogger().with({ domain: "outbox", component: "service" }),
});
