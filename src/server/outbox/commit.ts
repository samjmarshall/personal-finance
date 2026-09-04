import type { Inngest } from "inngest";

import type { db as realDb } from "~/server/db";
import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { markFailed, markProcessed } from "./ack";
import { outbox } from "./outbox.schema";

interface Deps {
	db: typeof realDb;
	inngest: Pick<Inngest, "send">;
}

/** The caller's canonical Drizzle writes, run inside the outbox transaction. */
type Writes<T> = (
	tx: Parameters<Parameters<typeof realDb.transaction>[0]>[0],
) => Promise<T>;

/**
 * Events to enqueue, derived from the writes' result. Taking a function (not a ready
 * array) is what lets an event carry a DB-generated id — `receiptId` is the identity
 * PK the insert only produces inside the transaction, so it can't be known at call time.
 */
type Events<T> = (result: T) => OutboxEventDescriptor[];

/**
 * The write door (adr002 clause 3). Canonical writes + the outbox rows commit in one
 * transaction; a best-effort post-commit `inngest.send` is the fast path and the sweep
 * cron the backstop. A failed send never surfaces — the committed row is the contract,
 * so the caller's mutation succeeds and the sweep re-delivers.
 */
export function makeCommitWithOutbox({ db, inngest }: Deps) {
	return async function commitWithOutbox<T>(
		writes: Writes<T>,
		events: Events<T>,
	): Promise<T> {
		let outboxEvents: OutboxEventDescriptor[] = [];
		const result = await db.transaction(async (tx) => {
			const value = await writes(tx);
			outboxEvents = events(value);

			if (outboxEvents.length) {
				await tx.insert(outbox).values(outboxEvents);
			}

			return value;
		});

		for (const e of outboxEvents) {
			try {
				await inngest.send(e);
				await markProcessed(db, e.id, "send");
			} catch (error) {
				await markFailed(db, e.id, error, "send");
			}
		}

		return result;
	};
}

/** Emit-only write: an outbox event with no other canonical rows. */
export function makePublish(deps: Deps) {
	const commitWithOutbox = makeCommitWithOutbox(deps);

	return (event: OutboxEventDescriptor) =>
		commitWithOutbox(
			async () => {},
			() => [event],
		);
}
