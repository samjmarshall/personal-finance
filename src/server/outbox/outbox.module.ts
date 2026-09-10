import { db } from "~/server/db";
import { inngest } from "~/server/inngest/client";

import { DrizzleOutboxRepository } from "./outbox.repository";
import { OutboxService } from "./outbox.service";

// Module surface `{ service }` (adr004): one instance shared by every write-door
// caller (routers, the inbound route's repository) and by the cron controller built
// in src/server/inngest/functions.ts.
export const outboxService = new OutboxService({
	repository: new DrizzleOutboxRepository({ db }),
	inngest,
});
