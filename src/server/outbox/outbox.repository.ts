import { and, eq, isNull, lt, sql } from "drizzle-orm";

import type { db as realDb } from "~/server/db";
import type { OutboxEventDescriptor } from "~/server/inngest/events";

import { outbox } from "./outbox.schema";

/** Full stored row, internal columns included. */
export type OutboxRow = typeof outbox.$inferSelect;

/** The caller's canonical Drizzle writes, run inside the outbox transaction. */
export type OutboxWrites<T> = (
	tx: Parameters<Parameters<typeof realDb.transaction>[0]>[0],
) => Promise<T>;

/**
 * Events to enqueue, derived from the writes' result. A function (not a ready array)
 * so an event can carry a DB-generated id — `receiptId` is the identity PK the insert
 * only produces inside the transaction, so it can't be known at call time.
 */
export type OutboxEvents<T> = (result: T) => OutboxEventDescriptor[];

/**
 * Data tier for the `outbox` table. Pure storage: every method throws on a driver
 * failure and logs nothing — best-effort semantics belong to the service.
 */
export interface OutboxRepository {
	/**
	 * Canonical writes + their outbox rows in one transaction (adr002 clause 3).
	 * Returns the writes' result and the rows enqueued, for the post-commit send.
	 */
	commit<T>(
		writes: OutboxWrites<T>,
		events: OutboxEvents<T>,
	): Promise<{ result: T; events: OutboxEventDescriptor[] }>;
	/** Unacked rows older than the 30s floor, oldest first. */
	findUnsent(): Promise<OutboxRow[]>;
	/** Stamp `processedAt = now`. */
	markProcessed(id: string): Promise<void>;
	/** `attempts + 1`, `lastError = message`. Row stays unacked. */
	markFailed(id: string, message: string): Promise<void>;
	/** Delete acked rows past 7-day retention; returns the count. Never matches unacked rows. */
	deleteProcessed(): Promise<number>;
}

interface DrizzleOutboxRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleOutboxRepository implements OutboxRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleOutboxRepositoryDeps) {
		this.db = db;
	}

	async commit<T>(
		writes: OutboxWrites<T>,
		events: OutboxEvents<T>,
	): Promise<{ result: T; events: OutboxEventDescriptor[] }> {
		return this.db.transaction(async (tx) => {
			const result = await writes(tx);
			const enqueued = events(result);
			if (enqueued.length) {
				await tx.insert(outbox).values(enqueued);
			}
			return { result, events: enqueued };
		});
	}

	// The 30s age floor keeps the sweep from racing a still-in-flight post-commit send
	// (adr002 clause 4). Served by the partial index in outbox.schema.ts.
	async findUnsent(): Promise<OutboxRow[]> {
		return this.db
			.select()
			.from(outbox)
			.where(
				and(
					isNull(outbox.processedAt),
					lt(outbox.createdAt, sql`now() - interval '30 seconds'`),
				),
			)
			.orderBy(outbox.createdAt);
	}

	async markProcessed(id: string): Promise<void> {
		await this.db
			.update(outbox)
			.set({ processedAt: new Date() })
			.where(eq(outbox.id, id));
	}

	async markFailed(id: string, message: string): Promise<void> {
		await this.db
			.update(outbox)
			.set({ attempts: sql`${outbox.attempts} + 1`, lastError: message })
			.where(eq(outbox.id, id));
	}

	// `processed_at < …` is NULL-false, so unacked and stuck rows (`processed_at is null`)
	// are never matched — they stay visible until cleared deliberately (adr002).
	async deleteProcessed(): Promise<number> {
		const deleted = await this.db
			.delete(outbox)
			.where(lt(outbox.processedAt, sql`now() - interval '7 days'`))
			.returning({ id: outbox.id });
		return deleted.length;
	}
}
