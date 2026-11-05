import type {
	AnswerInput,
	ApplyAnswersInput,
	CurrentApply,
} from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { ConflictError } from "~/server/errors/domain-errors";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import type { Logger } from "~/server/observability/logging/logger";
import type { TransactionsRepository } from "./transactions.repository";

// One worker step: a retry redoes at most this many, and skips the done ones.
const APPLY_BATCH = 50;
// Every Answer bumps the Apply's last-touched time, so this long with none
// means its job is dead (adr032).
const APPLY_STALE_MS = 15 * 60_000;

/** A running Apply touched since this is still alive. */
export const applyActiveSince = (now = Date.now()) =>
	new Date(now - APPLY_STALE_MS);

export type DuplicateApplyRepository = Pick<
	TransactionsRepository,
	| "startApply"
	| "nextApplyBatch"
	| "applyAnswer"
	| "releaseAnswer"
	| "finishApply"
	| "failApply"
	| "latestApply"
>;

// Its own service: tRPC and the duplicate-apply worker share these methods,
// and nothing else in Transactions needs them (service split rule).
interface DuplicateApplyServiceDeps {
	repository: DuplicateApplyRepository;
	logger: Logger;
}

/** Runs a Member's Answers in the background, one Apply at a time (adr032). */
export class DuplicateApplyService {
	private readonly repository: DuplicateApplyRepository;
	private readonly logger: Logger;

	constructor({ repository, logger }: DuplicateApplyServiceDeps) {
		this.repository = repository;
		this.logger = logger;
	}

	/** Stops a dead Apply first, so it never blocks this one. */
	async start({ answers }: ApplyAnswersInput): Promise<CurrentApply> {
		try {
			return await this.repository.startApply(answers, applyActiveSince());
		} catch (error) {
			if (isPgViolation(error, PgViolation.UniqueViolation)) {
				throw new ConflictError("An apply is already running.", {
					cause: error,
				});
			}

			throw error;
		}
	}

	/**
	 * In the order taken: a Keep mine must land before a Use bank's on its row.
	 * A late worker leaves an Apply the Member already sees as stopped (adr032).
	 */
	async applyBatch(applyId: number): Promise<{ more: boolean }> {
		const batch = await this.repository.nextApplyBatch(
			applyId,
			APPLY_BATCH,
			applyActiveSince(),
		);

		for (const answer of batch) {
			await this.applyOne(applyId, answer);
		}

		return { more: batch.length === APPLY_BATCH };
	}

	finish(applyId: number): Promise<void> {
		return this.repository.finishApply(applyId, applyActiveSince());
	}

	/** Called once Inngest's retries run out. */
	async fail(applyId: number, message: string): Promise<void> {
		await this.repository.failApply(applyId, message);
		this.logger.error("duplicate apply failed", { applyId, message });
	}

	/** Null before the first Apply. */
	async current(): Promise<CurrentApply | null> {
		const row = await this.repository.latestApply();

		if (!row) return null;

		return {
			...row,
			active:
				row.status === DuplicateApplyStatus.Running &&
				row.updatedAt > applyActiveSince(),
			// Saved only at the finish, so a stopped Apply's is the rest of its total.
			gone:
				row.status === DuplicateApplyStatus.Done
					? row.gone
					: row.total - row.applied - row.taken - row.pending,
		};
	}

	// A skipped review isn't counted; the final tally derives it from the total.
	private async applyOne(applyId: number, answer: AnswerInput): Promise<void> {
		try {
			await this.repository.applyAnswer(applyId, answer);
		} catch (error) {
			// Use bank's moves the bank id onto the household row; another row may hold it.
			if (!isPgViolation(error, PgViolation.UniqueViolation)) throw error;

			await this.repository.releaseAnswer(applyId, answer.id);
		}
	}
}
