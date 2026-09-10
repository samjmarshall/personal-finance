import type { Inngest } from "inngest";

import type { OutboxEventDescriptor } from "~/server/inngest/events";

import type {
	OutboxEvents,
	OutboxRepository,
	OutboxWrites,
} from "./outbox.repository";

/**
 * The write door (adr002 clause 3): what a domain repository injects to emit events.
 * Canonical writes + outbox rows commit in one transaction; a best-effort post-commit
 * send is the fast path and the sweep cron the backstop. A failed send never
 * surfaces — the committed row is the contract, so the caller's write succeeds.
 */
export interface OutboxWriteDoor {
	/** Resolves to the writes' result once committed and the sends attempted. */
	commit<T>(writes: OutboxWrites<T>, events: OutboxEvents<T>): Promise<T>;
	/** Emit-only write: an outbox row with no other canonical rows. */
	publish(event: OutboxEventDescriptor): Promise<void>;
}

/** Which path is delivering — a log tag only. */
type DeliveryContext = "send" | "sweep";

interface OutboxServiceDeps {
	repository: OutboxRepository;
	inngest: Pick<Inngest, "send">;
}

/**
 * Application tier for the outbox (adr002). The write door for producers plus one
 * public method per backstop cron; the repository is the only way to the table.
 */
export class OutboxService implements OutboxWriteDoor {
	private readonly repository: OutboxRepository;
	private readonly inngest: Pick<Inngest, "send">;

	constructor({ repository, inngest }: OutboxServiceDeps) {
		this.repository = repository;
		this.inngest = inngest;
	}

	async commit<T>(
		writes: OutboxWrites<T>,
		events: OutboxEvents<T>,
	): Promise<T> {
		const { result, events: enqueued } = await this.repository.commit(
			writes,
			events,
		);
		for (const event of enqueued) await this.deliver(event, "send");
		return result;
	}

	async publish(event: OutboxEventDescriptor): Promise<void> {
		await this.commit(
			async () => {},
			() => [event],
		);
	}

	/**
	 * Re-deliver committed-but-unsent rows. Each re-send uses `id` = the row id (the
	 * idempotency key), so a race with the post-commit send is a no-op inside Inngest's
	 * 24h dedup window. A failing send bumps attempts/lastError and leaves the row
	 * unacked for the next run.
	 *
	 * Deferred until producers exist (no live callers yet): no LIMIT/batch (a large
	 * backlog loads in one array) and no max-attempts cap / dead-letter (a poison row
	 * re-sends hourly forever). Past the 24h dedup window a re-send delivers again, so
	 * consumers must be idempotent regardless.
	 */
	async sweep(): Promise<{ delivered: number; failed: number }> {
		const rows = await this.repository.findUnsent();

		let delivered = 0;
		let failed = 0;
		for (const row of rows) {
			// Project to the wire fields only — never ship internal columns
			// (attempts/processedAt/lastError, incl. raw error text) to the event store.
			const event: OutboxEventDescriptor = {
				id: row.id,
				name: row.name,
				data: row.data,
			};
			if (await this.deliver(event, "sweep")) delivered++;
			else failed++;
		}

		return { delivered, failed };
	}

	/** Drop acked rows past retention. Unacked and stuck rows are never touched (adr002). */
	async prune(): Promise<{ deleted: number }> {
		const deleted = await this.repository.deleteProcessed();
		return { deleted };
	}

	/** Send one event then ack it. Never throws: the committed row is the contract. */
	private async deliver(
		event: OutboxEventDescriptor,
		context: DeliveryContext,
	): Promise<boolean> {
		try {
			await this.inngest.send(event);
		} catch (error) {
			await this.recordFailure(event.id, error, context);
			return false;
		}
		await this.ack(event.id, context);
		return true;
	}

	// Both bookkeeping writes run *after* a successful commit, so a throw must never
	// surface — a producer would retry an already-durable write and duplicate rows,
	// and one stuck row would abort a sweep and starve every row behind it.
	private async ack(id: string, context: DeliveryContext): Promise<void> {
		try {
			await this.repository.markProcessed(id);
		} catch (error) {
			console.error(`outbox ack failed for ${id} (${context})`, error);
		}
	}

	private async recordFailure(
		id: string,
		error: unknown,
		context: DeliveryContext,
	): Promise<void> {
		console.error(`outbox ${context} delivery failed for ${id}`, error);
		const message = error instanceof Error ? error.message : String(error);
		try {
			await this.repository.markFailed(id, message);
		} catch (recordError) {
			console.error(
				`outbox failure-record failed for ${id} (${context})`,
				recordError,
			);
		}
	}
}
