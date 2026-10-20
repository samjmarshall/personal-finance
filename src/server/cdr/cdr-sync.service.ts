import {
	type CdrSyncState,
	mapRedbarkTransaction,
	type RedbarkAccount,
} from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import type { Logger } from "~/server/observability/logging/logger";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import { CdrSyncError } from "./cdr.errors";
import { type RedbarkClient, RedbarkRetryableError } from "./cdr.redbark";
import type { CdrRepository } from "./cdr.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 90;
// Fetch filters by txn date, but a card row can post 5+ days later (long weekend).
const OVERLAP_DAYS = 14;

const DEAD_CONSENT: CdrConnectionStatus[] = [
	CdrConnectionStatus.Revoked,
	CdrConnectionStatus.Expired,
	CdrConnectionStatus.Invalidated,
];

interface AccountFailure {
	accountId: string;
	error: unknown;
}

interface CdrSyncServiceDeps {
	repository: CdrRepository;
	/** Null when `REDBARK_API_KEY` is unset. */
	redbark: RedbarkClient | null;
	transactions: Pick<TransactionsService, "upsertSynced">;
	logger: Logger;
}

/**
 * Application tier for the daily bank sync. Idempotent: a re-run re-fetches the
 * overlap. Rows land before the cursor moves, so a failure never skips rows.
 */
export class CdrSyncService {
	private readonly repository: CdrRepository;
	private readonly redbark: RedbarkClient | null;
	private readonly transactions: Pick<TransactionsService, "upsertSynced">;
	private readonly logger: Logger;

	constructor({
		repository,
		redbark,
		transactions,
		logger,
	}: CdrSyncServiceDeps) {
		this.repository = repository;
		this.redbark = redbark;
		this.transactions = transactions;
		this.logger = logger;
	}

	/** Throws one `CdrSyncError` if any account failed, after every account has had its turn. */
	async run(): Promise<void> {
		if (!this.redbark) {
			this.logger.info("cdr sync skipped: REDBARK_API_KEY is not set");
			return;
		}

		const { statuses, accounts } = await this.discover(this.redbark);
		const accountsById = new Map(accounts.map((a) => [a.id, a]));

		const failures: AccountFailure[] = [];
		for (const saved of await this.repository.listSyncState()) {
			const account = accountsById.get(saved.accountId);
			const consent = statuses.get(
				account?.connection ?? saved.connectionId ?? "",
			);
			try {
				await this.syncIfReady(this.redbark, saved, account, consent);
			} catch (error) {
				failures.push({ accountId: saved.accountId, error });
				this.logger.error("cdr account sync failed", {
					accountId: saved.accountId,
					error,
				});
				try {
					await this.repository.recordError(
						saved.accountId,
						error instanceof Error ? error.message : String(error),
					);
				} catch (recordFailure) {
					// A failed note must not stop the other accounts or lose this failure.
					this.logger.error("cdr account error not saved", {
						accountId: saved.accountId,
						error: recordFailure,
					});
				}
			}
		}

		if (failures.length > 0)
			throw syncError(
				`cdr sync failed for ${failures.map((f) => f.accountId).join(", ")}`,
				failures.map((f) => f.error),
			);
	}

	private async discover(redbark: RedbarkClient): Promise<{
		statuses: Map<string, CdrConnectionStatus>;
		accounts: RedbarkAccount[];
	}> {
		try {
			const [connections, accounts] = await Promise.all([
				redbark.listConnections(),
				redbark.listAccounts(),
			]);
			const statuses = new Map(connections.map((c) => [c.id, c.status]));
			for (const account of accounts)
				await this.repository.upsertAccount({
					accountId: account.id,
					connectionId: account.connection,
					accountName: account.name,
					// An account on an unlisted connection stays parked until RedBark lists it.
					connectionStatus:
						statuses.get(account.connection) ?? CdrConnectionStatus.Pending,
				});
			// A dead bank may stop listing its accounts; its saved rows still need the status.
			for (const [connectionId, status] of statuses)
				await this.repository.setConnectionStatus(connectionId, status);
			return { statuses, accounts };
		} catch (cause) {
			throw syncError("cdr discovery failed", [cause]);
		}
	}

	private async syncIfReady(
		redbark: RedbarkClient,
		{ accountId, highWaterMark }: CdrSyncState,
		account: RedbarkAccount | undefined,
		consent: CdrConnectionStatus | undefined,
	): Promise<void> {
		if (consent && DEAD_CONSENT.includes(consent)) {
			this.logger.warn("cdr connection needs reauthorizing", {
				accountId,
				consent,
			});
			return;
		}
		if (!account) throw new Error("not in RedBark");
		if (consent === undefined || consent === CdrConnectionStatus.Pending) {
			this.logger.info("cdr connection not active yet", { accountId });
			return;
		}
		if (consent === CdrConnectionStatus.Expiring)
			this.logger.warn("cdr connection expiring: reauthorize soon", {
				accountId,
			});

		if (account.status === "syncing") {
			// Syncing now could move the mark past rows that land later.
			this.logger.info("cdr account still syncing in RedBark", { accountId });
			return;
		}
		if (account.status === "unavailable") {
			this.logger.warn("cdr account unavailable in RedBark", { accountId });
			await this.repository.recordError(accountId, "unavailable in RedBark");
			return;
		}

		await this.syncAccount(redbark, account, highWaterMark);
	}

	private async syncAccount(
		redbark: RedbarkClient,
		account: RedbarkAccount,
		mark: Date | null,
	): Promise<void> {
		const now = new Date();
		const from = mark
			? new Date(mark.getTime() - OVERLAP_DAYS * DAY_MS)
			: new Date(now.getTime() - BACKFILL_DAYS * DAY_MS);

		const rows = (
			await redbark.listTransactions({ accountId: account.id, from })
		).map((row) => mapRedbarkTransaction(row, account.name));
		await this.transactions.upsertSynced(rows);

		// The mark is monotonic, so one bad future date would stall the account for good.
		const newest = rows.reduce<Date | null>(
			(max, row) => (!max || row.date > max ? row.date : max),
			null,
		);
		await this.repository.advanceHighWaterMark(
			account.id,
			newest
				? new Date(Math.min(newest.getTime(), now.getTime()))
				: (mark ?? from),
			now,
		);
	}
}

// A mapping throw or a 4xx fails the same way every attempt; only a
// transient error is worth a retry.
function syncError(message: string, errors: unknown[]): CdrSyncError {
	const transient = errors.filter(
		(error) => error instanceof RedbarkRetryableError,
	);
	const waits = transient.flatMap(({ retryAfterMs }) =>
		retryAfterMs === null ? [] : [retryAfterMs],
	);
	return new CdrSyncError(message, {
		retryable: transient.length > 0,
		retryAfterMs: waits.length > 0 ? Math.max(...waits) : null,
		cause: errors[0],
	});
}
