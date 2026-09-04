import { and, isNull, lt, sql } from "drizzle-orm";

import type { Inngest } from "inngest";

import type { db as realDb } from "~/server/db";
import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { markFailed, markProcessed } from "./ack";
import { outbox } from "./outbox.schema";

interface SweepCoreDeps {
	db: typeof realDb;
	deliver: (event: OutboxEventDescriptor) => Promise<unknown>;
}

/**
 * Pure sweep core (adr002 clauses 4–5): re-deliver committed-but-unsent outbox rows.
 * The 30s age floor keeps the sweep from racing a still-in-flight post-commit send;
 * `deliver` re-sends with `id` = the row id (the idempotency key), so a race is a
 * guaranteed no-op inside Inngest's 24h dedup window. A failing delivery bumps
 * attempts/lastError and leaves the row unacked for the next run.
 *
 * Deferred until stage-5 producers exist (no live callers yet): no LIMIT/batch (a large
 * backlog loads in one array) and no max-attempts cap / dead-letter (a poison row
 * re-sends hourly forever). Idempotency lives on the *consumer*: past the 24h dedup
 * window a re-send delivers again, so stage-5 workers must be idempotent regardless.
 */
export function makeRunSweep({ db, deliver }: SweepCoreDeps) {
	return async function runSweep() {
		const rows = await db
			.select()
			.from(outbox)
			.where(
				and(
					isNull(outbox.processedAt),
					lt(outbox.createdAt, sql`now() - interval '30 seconds'`),
				),
			)
			.orderBy(outbox.createdAt);

		let delivered = 0;
		let failed = 0;
		for (const row of rows) {
			try {
				await deliver(row);
				await markProcessed(db, row.id, "sweep");
				delivered++;
			} catch (error) {
				await markFailed(db, row.id, error, "sweep delivery");
				failed++;
			}
		}

		return { delivered, failed };
	};
}

interface PruneCoreDeps {
	db: typeof realDb;
}

/**
 * Pure prune core: drop acked rows past the 7-day retention window. `processed_at < …`
 * is NULL-false, so unacked and stuck rows (`processed_at is null`) are never matched —
 * they stay visible until cleared deliberately (adr002).
 */
export function makeRunPrune({ db }: PruneCoreDeps) {
	return async function runPrune() {
		const deleted = await db
			.delete(outbox)
			.where(lt(outbox.processedAt, sql`now() - interval '7 days'`))
			.returning({ id: outbox.id });
		return { deleted: deleted.length };
	};
}

interface WorkerDeps {
	db: typeof realDb;
	inngest: Pick<Inngest, "send" | "createFunction">;
}

/** Hourly sweep worker; `deliver` re-sends via the real client with the row id as key. */
export function makeSweepWorker({ db, inngest }: WorkerDeps) {
	const runSweep = makeRunSweep({
		db,
		deliver: (e) => inngest.send(e),
	});
	return inngest.createFunction(
		{ id: "outbox-sweep", triggers: [{ cron: "0 * * * *" }] },
		() => runSweep(),
	);
}

/** Daily prune worker — no `send`, so it only needs `createFunction`. */
export function makePruneWorker({ db, inngest }: WorkerDeps) {
	const runPrune = makeRunPrune({ db });
	return inngest.createFunction(
		{ id: "outbox-prune", triggers: [{ cron: "0 3 * * *" }] },
		() => runPrune(),
	);
}
