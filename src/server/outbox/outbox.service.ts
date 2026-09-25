import { context, SpanStatusCode } from "@opentelemetry/api";
import type { Inngest } from "inngest";

import type { OutboxEventDescriptor } from "~/server/inngest/events";
import { BaggageKey, setBaggage } from "~/server/observability/baggage";
import { errorMessage, type Logger } from "~/server/observability/logger";
import { failSpan, tracer } from "~/server/observability/tracer";

import type {
	OutboxEvents,
	OutboxRepository,
	OutboxWrites,
} from "./outbox.repository";

// A row the sweep has already failed to deliver this many times is stuck — a
// poison send or a consumer that never runs (adr002). Gate on attempts, not
// age: age past one sweep interval also tags a healthy first re-delivery.
const STUCK_AFTER_ATTEMPTS = 3;

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
	logger: Logger;
}

/**
 * Application tier for the outbox (adr002). The write door for producers plus one
 * public method per backstop cron; the repository is the only way to the table.
 */
export class OutboxService implements OutboxWriteDoor {
	private readonly repository: OutboxRepository;
	private readonly inngest: Pick<Inngest, "send">;
	private readonly logger: Logger;

	constructor({ repository, inngest, logger }: OutboxServiceDeps) {
		this.repository = repository;
		this.inngest = inngest;
		this.logger = logger;
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
			const ageS = Math.round((Date.now() - row.createdAt.getTime()) / 1000);
			const acked = await tracer.startActiveSpan(
				"outbox.sweep.row",
				{
					attributes: {
						[BaggageKey.OutboxEventId]: row.id,
						"outbox.attempts": row.attempts,
						"outbox.age_s": ageS,
					},
				},
				async (span) => {
					try {
						// Project to the wire fields only — never ship internal columns
						// (attempts/processedAt/lastError, incl. raw error text) to Inngest.
						const event: OutboxEventDescriptor = {
							id: row.id,
							name: row.name,
							data: row.data,
						};
						const ok = await this.deliver(event, "sweep");
						// Judge stuck after this try, so a row that just went through never alerts.
						const attempts = row.attempts + 1;
						if (!ok && attempts >= STUCK_AFTER_ATTEMPTS) {
							this.logger.warn("outbox row stuck", {
								"event.name": "outbox.sweep.stuck",
								[BaggageKey.OutboxEventId]: row.id,
								"outbox.event_name": row.name,
								"outbox.attempts": attempts,
								"outbox.age_s": ageS,
							});
						}
						return ok;
					} finally {
						span.end();
					}
				},
			);
			if (acked) delivered++;
			else failed++;
		}

		return { delivered, failed };
	}

	/** Drop acked rows past retention. Unacked and stuck rows are never touched (adr002). */
	async prune(): Promise<{ deleted: number }> {
		const deleted = await this.repository.deleteProcessed();
		return { deleted };
	}

	/**
	 * Send one event then ack it. Never throws: the committed row is the contract.
	 * The `outbox delivered` heartbeat fires only on a durable ack — a swallowed
	 * markProcessed failure leaves the row for the next sweep, so claiming delivery
	 * would be a lie.
	 */
	private async deliver(
		event: OutboxEventDescriptor,
		deliveryContext: DeliveryContext,
	): Promise<boolean> {
		const baggageCtx = setBaggage({ [BaggageKey.OutboxEventId]: event.id });
		const log = this.logger.with({
			[BaggageKey.OutboxEventId]: event.id,
			"outbox.event_name": event.name,
			"outbox.delivery_context": deliveryContext,
		});
		return context.with(baggageCtx, () =>
			tracer.startActiveSpan(
				"outbox.deliver",
				{
					attributes: {
						[BaggageKey.OutboxEventId]: event.id,
						"outbox.event_name": event.name,
						"outbox.delivery_context": deliveryContext,
					},
				},
				async (span) => {
					try {
						try {
							await this.inngest.send(event);
						} catch (error) {
							failSpan(span, error);
							await this.recordFailure(event.id, error, log);
							return false;
						}
						const acked = await this.ack(event.id, log);
						if (acked) {
							log.info("outbox delivered");
						} else {
							// Sent but the ack write failed: the row stays unsent and the next
							// sweep retries it. Fail the span and return false so the trace and
							// the sweep's failed count both match reality.
							span.setStatus({
								code: SpanStatusCode.ERROR,
								message: "ack failed",
							});
						}
						return acked;
					} finally {
						span.end();
					}
				},
			),
		);
	}

	// Both bookkeeping writes run *after* a successful commit, so a throw must never
	// surface — a producer would retry an already-durable write and duplicate rows,
	// and one stuck row would abort a sweep and starve every row behind it.
	private async ack(id: string, log: Logger): Promise<boolean> {
		try {
			await this.repository.markProcessed(id);
			return true;
		} catch (error) {
			log.error("outbox ack failed", { error });
			// Count it as a failed try too, or a row that never acks is never stuck.
			try {
				await this.repository.markFailed(
					id,
					`ack failed: ${errorMessage(error)}`,
				);
			} catch {
				// Same db that just failed the ack; the error above already says so.
			}
			return false;
		}
	}

	private async recordFailure(
		id: string,
		error: unknown,
		log: Logger,
	): Promise<void> {
		log.error("outbox delivery failed", { error });
		try {
			await this.repository.markFailed(id, errorMessage(error));
		} catch (recordError) {
			log.error("outbox failure-record failed", { error: recordError });
		}
	}
}
