import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { outboxService } from "./outbox.module";
import type { OutboxEvents, OutboxWrites } from "./outbox.repository";

// Bound entry points for the not-yet-migrated tRPC routers (routers/receipts.ts). A
// migrated domain injects `outboxService` as `OutboxWriteDoor` into its repository
// instead — see email/email.repository.ts.
export const commitWithOutbox = <T>(
	writes: OutboxWrites<T>,
	events: OutboxEvents<T>,
): Promise<T> => outboxService.commit(writes, events);

export const publish = (event: OutboxEventDescriptor): Promise<void> =>
	outboxService.publish(event);

export { outboxService } from "./outbox.module";
export type { OutboxEvents, OutboxWrites } from "./outbox.repository";
export { outbox } from "./outbox.schema";
export type { OutboxWriteDoor } from "./outbox.service";
