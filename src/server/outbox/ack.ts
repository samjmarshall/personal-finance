import { eq, sql } from "drizzle-orm";

import type { db as realDb } from "~/server/db";

import { outbox } from "./outbox.schema";

/** Which post-commit path is acking — used only as a log tag. */
type AckContext = "send" | "sweep" | "sweep delivery";

/**
 * Best-effort outbox bookkeeping shared by the fast path (commit.ts) and the sweep
 * (outbox.workers.ts). Both run *after* the canonical commit, so a throw here must never
 * surface: the committed row is the contract and the sweep re-delivers. Each logs +
 * swallows its own failure. `context` tags the log with the caller ("send"/"sweep").
 */
export async function markProcessed(
	db: typeof realDb,
	id: string,
	context: AckContext,
): Promise<void> {
	try {
		await db
			.update(outbox)
			.set({ processedAt: new Date() })
			.where(eq(outbox.id, id));
	} catch (error) {
		console.error(`outbox ack failed for ${id} (${context})`, error);
	}
}

export async function markFailed(
	db: typeof realDb,
	id: string,
	error: unknown,
	context: AckContext,
): Promise<void> {
	const lastError = error instanceof Error ? error.message : String(error);
	console.error(`outbox ${context} failed for ${id}`, error);
	try {
		await db
			.update(outbox)
			.set({ attempts: sql`${outbox.attempts} + 1`, lastError })
			.where(eq(outbox.id, id));
	} catch (recordError) {
		console.error(
			`outbox failure-record failed for ${id} (${context})`,
			recordError,
		);
	}
}
