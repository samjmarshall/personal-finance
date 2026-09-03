import { eq, sql } from "drizzle-orm";

import type { Inngest } from "inngest";

import type { db as realDb } from "~/server/db";
import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { outbox } from "./outbox.schema";

interface Deps {
	db: typeof realDb;
	inngest: Pick<Inngest, "send">;
}

/** The caller's canonical Drizzle writes, run inside the outbox transaction. */
type Writes<T> = (
	tx: Parameters<Parameters<typeof realDb.transaction>[0]>[0],
) => Promise<T>;

const toRow = (e: OutboxEventDescriptor) => ({
	id: e.id,
	eventName: e.name,
	payload: e.data,
});

/**
 * The write door (adr002 clause 3). Canonical writes + the outbox rows commit in one
 * transaction; a best-effort post-commit `inngest.send` is the fast path and the sweep
 * cron the backstop. A failed send never surfaces — the committed row is the contract,
 * so the caller's mutation succeeds and the sweep re-delivers.
 */
export function makeCommitWithOutbox({ db, inngest }: Deps) {
	return async function commitWithOutbox<T>(
		writes: Writes<T>,
		events: OutboxEventDescriptor[],
	): Promise<T> {
		const result = await db.transaction(async (tx) => {
			const value = await writes(tx);
			if (events.length) await tx.insert(outbox).values(events.map(toRow));
			return value;
		});

		for (const event of events) {
			try {
				await inngest.send({
					id: event.id,
					name: event.name,
					data: event.data,
				});
				await db
					.update(outbox)
					.set({ processedAt: new Date() })
					.where(eq(outbox.id, event.id));
			} catch (error) {
				const lastError =
					error instanceof Error ? error.message : String(error);
				console.error(`outbox send failed for ${event.id}`, error);
				await db
					.update(outbox)
					.set({ attempts: sql`${outbox.attempts} + 1`, lastError })
					.where(eq(outbox.id, event.id));
			}
		}

		return result;
	};
}

/** Emit-only write: an outbox event with no other canonical rows. */
export function makePublish(deps: Deps) {
	const commitWithOutbox = makeCommitWithOutbox(deps);
	return (event: OutboxEventDescriptor) =>
		commitWithOutbox(async () => {}, [event]);
}
