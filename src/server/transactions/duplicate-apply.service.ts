import type {
	AnswerInput,
	ApplyAnswersInput,
	CurrentApply,
} from "~/domain/transactions";
import { DuplicateApplyStatus } from "~/lib/constants";
import { ConflictError } from "~/server/errors/domain-errors";
import { isPgViolation, PgViolation } from "~/server/errors/parse-error";
import { errorMessage } from "~/server/observability/errors/thrown";
import type { Logger } from "~/server/observability/logging/logger";
import type { TransactionsRepository } from "./transactions.repository";

// One worker step: a retry redoes at most this many, and skips the done ones.
const APPLY_BATCH = 50;
// Each Answer that lands bumps the Apply's last-touched time, so this long with
// none means its job is dead (adr032).
const APPLY_STALE_MS = 15 * 60_000;
const LATE_FINISH_ERROR = "No progress; its worker finished too late.";

// A failed query's own message lists the Answer's values; the reason sits on its
// cause. A few hops at most, so a cause that loops can't spin.
function rootMessage(error: unknown): string {
	let root = error;

	for (let hop = 0; hop < 5; hop += 1) {
		const cause = (root as { cause?: unknown } | null)?.cause;

		if (!cause) break;

		root = cause;
	}

	return errorMessage(root);
}

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
	 * Never reorders the batch: a Keep mine must land before a Use bank's on its row.
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

	/** A worker past the stuck limit stops its Apply instead: the Member already sees it stopped. */
	async finish(applyId: number): Promise<void> {
		if (await this.repository.finishApply(applyId, applyActiveSince())) return;

		const stopped = await this.repository.failApply(applyId, LATE_FINISH_ERROR);
		this.logger.error("duplicate apply finished late", { applyId, stopped });
	}

	/** Called once Inngest's retries run out. */
	async fail(applyId: number, error: unknown): Promise<void> {
		const message = rootMessage(error);

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
			// Saved only at the finish; a stopped Apply's is whatever wasn't applied, taken or left pending.
			gone:
				row.status === DuplicateApplyStatus.Done
					? row.gone
					: row.total - row.applied - row.taken - row.pending,
		};
	}

	// A skipped review isn't counted; the final tally derives it from the total.
	// The clock is read per Answer: a slow batch can cross the stuck limit.
	private async applyOne(applyId: number, answer: AnswerInput): Promise<void> {
		try {
			await this.repository.applyAnswer(applyId, answer, applyActiveSince());
		} catch (error) {
			// Use bank's moves the bank id onto the household row; another row may hold it.
			if (!isPgViolation(error, PgViolation.UniqueViolation)) throw error;

			await this.repository.releaseAnswer(
				applyId,
				answer.id,
				applyActiveSince(),
			);
		}
	}
}
