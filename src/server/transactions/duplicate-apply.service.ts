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
// Every Answer moves the Apply's `updatedAt`, so this long with none means its
// job is dead (adr032).
const APPLY_STALE_MS = 15 * 60_000;

/** A running Apply updated after this may still report. */
export const applyActiveSince = (now = Date.now()) =>
	new Date(now - APPLY_STALE_MS);

export type DuplicateApplyRepository = Pick<
	TransactionsRepository,
	| "startApply"
	| "takeApplyBatch"
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

	/** Fails a stuck Apply first, so it never blocks this one. */
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

	/** In the order taken: a Keep mine must land before a Use bank's on its row. */
	async applyBatch(applyId: number): Promise<{ more: boolean }> {
		const batch = await this.repository.takeApplyBatch(applyId, APPLY_BATCH);

		for (const answer of batch) {
			await this.applyOne(applyId, answer);
		}

		return { more: batch.length === APPLY_BATCH };
	}

	finish(applyId: number): Promise<void> {
		return this.repository.finishApply(applyId);
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
		};
	}

	// A gone review needs no count here: finish works it out from the total.
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
