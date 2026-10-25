import {
	anchorFromBalances,
	type CdrSyncState,
	inBalanceByDefault,
	isDeadConsent,
	latestBalance,
	mapRedbarkTransaction,
	type RedbarkAccount,
	type RedbarkBalance,
} from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import type { BalancesService } from "~/server/balances/balances.service";
import type { Logger } from "~/server/observability/logging/logger";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import { CdrSyncError } from "./cdr.errors";
import { type RedbarkClient, RedbarkRetryableError } from "./cdr.redbark";
import type { CdrRepository } from "./cdr.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DAYS = 90;
// Fetch filters by txn date, but a card row can post 5+ days later (long weekend).
const OVERLAP_DAYS = 14;

const SYNCING_CONSENT: CdrConnectionStatus[] = [
	CdrConnectionStatus.Active,
	CdrConnectionStatus.Expiring,
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
	balances: Pick<BalancesService, "recordSynced">;
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
	private readonly balances: Pick<BalancesService, "recordSynced">;
	private readonly logger: Logger;

	constructor({
		repository,
		redbark,
		transactions,
		balances,
		logger,
	}: CdrSyncServiceDeps) {
		this.repository = repository;
		this.redbark = redbark;
		this.transactions = transactions;
		this.balances = balances;
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
		const consentOf = (saved: CdrSyncState) =>
			statuses.get(
				accountsById.get(saved.accountId)?.connection ??
					saved.connectionId ??
					"",
			);

		const states = await this.repository.listSyncState();
		const failures: AccountFailure[] = [];
		for (const saved of states) {
			const account = accountsById.get(saved.accountId);
			const consent = consentOf(saved);
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

		const balances = await this.readBalances(
			this.redbark,
			accounts
				.filter((a) => {
					const consent = statuses.get(a.connection);
					return consent !== undefined && SYNCING_CONSENT.includes(consent);
				})
				.map((a) => a.id),
		);

		const failed = new Set(failures.map((f) => f.accountId));
		const blocker = this.anchorBlocker(states, accountsById, (saved) => {
			const account = accountsById.get(saved.accountId);
			const consent = consentOf(saved);
			return (
				!failed.has(saved.accountId) &&
				account?.status === "available" &&
				consent !== undefined &&
				SYNCING_CONSENT.includes(consent)
			);
		});
		if (blocker) this.logger.info(`cdr balance anchor skipped: ${blocker}`);
		else await this.anchorBalance(states, balances);

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
					institutionName: account.institution.name,
					accountNumber: account.account_number,
					// An account on an unlisted connection stays parked until RedBark lists it.
					connectionStatus:
						statuses.get(account.connection) ?? CdrConnectionStatus.Pending,
					inBalance: inBalanceByDefault(account.type),
				});
			// A dead bank may stop listing its accounts; its saved rows still need the status.
			for (const [connectionId, status] of statuses)
				await this.repository.setConnectionStatus(connectionId, status);
			return { statuses, accounts };
		} catch (cause) {
			throw syncError("cdr discovery failed", [cause]);
		}
	}

	/**
	 * Why the anchor can't be trusted this run, or null. Reads each saved flag,
	 * never the type default, so a member's Settings → Bank accounts choice holds.
	 */
	private anchorBlocker(
		states: CdrSyncState[],
		accountsById: Map<string, RedbarkAccount>,
		syncedOk: (saved: CdrSyncState) => boolean,
	): string | null {
		const undecided = states.filter((s) => s.inBalance === null);
		// An undecided account may be savings under an odd type name; leaving it out would shrink the sum.
		for (const { accountId } of undecided)
			this.logger.warn("cdr account not set in or out of the balance", {
				accountId,
				type: accountsById.get(accountId)?.type ?? null,
			});
		if (undecided.length > 0) return "an account is undecided";
		if (!states.some((s) => s.inBalance)) return "no account counts";
		// A left-out account never blocks: a loan failing daily would hold the cash line for good.
		if (states.some((s) => s.inBalance && !syncedOk(s)))
			return "a counted account did not sync";
		return null;
	}

	/**
	 * One read for Settings → Bank accounts and the anchor. Never fails the run: the
	 * list keeps its last balance and the anchor skips. Keyed by account id.
	 */
	private async readBalances(
		redbark: RedbarkClient,
		accountIds: string[],
	): Promise<Map<string, RedbarkBalance>> {
		if (accountIds.length === 0) return new Map();
		try {
			const balances = await redbark.listBalances(accountIds);
			for (const balance of balances) {
				const latest = latestBalance(balance);
				if (latest)
					await this.repository.recordBalance(balance.account, latest);
			}
			return new Map(balances.map((b) => [b.account, b]));
		} catch (error) {
			this.logger.error("cdr balance read failed", { error });
			return new Map();
		}
	}

	// Never fails the run: a retry re-fetches every account, and the next daily run anchors.
	private async anchorBalance(
		states: CdrSyncState[],
		balancesById: Map<string, RedbarkBalance>,
	): Promise<void> {
		const balances: RedbarkBalance[] = [];
		for (const { accountId } of states.filter((s) => s.inBalance)) {
			const balance = balancesById.get(accountId);
			if (!balance) {
				this.logger.info(
					"cdr balance anchor skipped: a counted balance is missing",
					{ accountId },
				);
				return;
			}
			balances.push(balance);
		}
		try {
			const anchor = anchorFromBalances(balances);
			if (!anchor) {
				this.logger.info(
					"cdr balance anchor skipped: a counted balance is not fresh",
				);
				return;
			}
			await this.balances.recordSynced(anchor);
		} catch (error) {
			this.logger.error("cdr balance anchor failed", { error });
		}
	}

	private async syncIfReady(
		redbark: RedbarkClient,
		{ accountId, highWaterMark }: CdrSyncState,
		account: RedbarkAccount | undefined,
		consent: CdrConnectionStatus | undefined,
	): Promise<void> {
		if (consent && isDeadConsent(consent)) {
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
