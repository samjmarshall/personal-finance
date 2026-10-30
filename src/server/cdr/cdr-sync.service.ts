import {
	anchorFromBalances,
	type CdrSyncState,
	type DayRange,
	importWindows,
	inBalanceByDefault,
	isDeadConsent,
	isSyncingConsent,
	latestBalance,
	mapRedbarkTransaction,
	type RedbarkAccount,
	type RedbarkBalance,
} from "~/domain/cdr";
import type { ReconcileCounts, SyncedTransaction } from "~/domain/transactions";
import { CdrConnectionStatus } from "~/lib/constants";
import { utcDayKey, utcMidnight } from "~/lib/utils";
import type { BalancesService } from "~/server/balances/balances.service";
import type { Logger } from "~/server/observability/logging/logger";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import { CdrSyncError } from "./cdr.errors";
import { type RedbarkClient, RedbarkRetryableError } from "./cdr.redbark";
import type { CdrRepository } from "./cdr.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
// Fetch filters by txn date, but a card row can post 5+ days later (long weekend).
// A first run fetches only this much too: older history comes from the import.
const OVERLAP_DAYS = 14;
// Inngest caps a run at 1,000 steps; the import also spends one each on claim, plan and finish.
const MAX_IMPORT_CHUNKS = 997;
// The run's own error is for us (Inngest keeps it); the member gets plain words.
const IMPORT_FAILED = "The import stopped on an error. Try again later.";

/** One account's slice of an import; dates are inclusive `YYYY-MM-DD`. */
export interface ImportChunk extends DayRange {
	accountId: string;
	accountName: string;
}

export interface ImportPlan {
	/** Every account RedBark lists, so a chunk's reconcile can tell a closed account from a live one. */
	liveAccountIds: string[];
	chunks: ImportChunk[];
}

interface AccountFailure {
	accountId: string;
	error: unknown;
}

interface CdrSyncServiceDeps {
	repository: CdrRepository;
	/** Null when `REDBARK_API_KEY` is unset. */
	redbark: RedbarkClient | null;
	transactions: Pick<TransactionsService, "reconcileSynced">;
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
	private readonly transactions: Pick<TransactionsService, "reconcileSynced">;
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
		const liveAccountIds = [...accountsById.keys()];
		const consentOf = (saved: CdrSyncState) =>
			statuses.get(
				accountsById.get(saved.accountId)?.connection ??
					saved.connectionId ??
					"",
			);

		// A DB blip moved no cursor, so the next daily run is the retry.
		const states = await this.repository
			.listSyncState()
			.catch((cause: unknown) => {
				throw syncError("cdr sync state read failed", [cause]);
			});
		const failures: AccountFailure[] = [];
		for (const saved of states) {
			const account = accountsById.get(saved.accountId);
			const consent = consentOf(saved);
			try {
				await this.syncIfReady(this.redbark, saved, account, consent, {
					liveAccountIds,
				});
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
					return consent !== undefined && isSyncingConsent(consent);
				})
				.map((a) => a.id),
		);

		const failed = new Set(failures.map((f) => f.accountId));
		const blocker = this.anchorBlocker(states, accountsById, (saved) => {
			const account = accountsById.get(saved.accountId);
			const consent = consentOf(saved);
			return !failed.has(saved.accountId) && isSyncable(account, consent);
		});
		if (blocker) this.logger.info(`cdr balance anchor skipped: ${blocker}`);
		else await this.anchorBalance(states, balances);

		if (failures.length > 0)
			throw syncError(
				`cdr sync failed for ${failures.map((f) => f.accountId).join(", ")}`,
				failures.map((f) => f.error),
			);
	}

	/**
	 * Moves an unfinished import to running and returns its day range. Null when it
	 * already finished (a repeat delivery), so the caller runs nothing.
	 */
	async claimImport(importId: number): Promise<DayRange | null> {
		const row = await this.repository.markImportRunning(importId);
		if (!row) {
			this.logger.info("cdr import already claimed", { importId });
			return null;
		}
		return { from: utcDayKey(row.fromDate), to: utcDayKey(row.toDate) };
	}

	/** Splits a claimed import into chunks. No chunks when it failed the import instead. */
	async planImport(
		importId: number,
		{ from, to }: DayRange,
	): Promise<ImportPlan> {
		if (!this.redbark) return this.failPlan(importId, "Bank sync isn't set up");

		const { statuses, accounts } = await this.discover(this.redbark);
		const windows = importWindows(from, to);
		const chunks: ImportChunk[] = [];
		for (const account of accounts) {
			if (!isSyncable(account, statuses.get(account.connection))) {
				this.logger.info("cdr import skipped an account", {
					importId,
					accountId: account.id,
				});
				continue;
			}
			for (const window of windows)
				chunks.push({
					accountId: account.id,
					accountName: account.name,
					...window,
				});
		}
		if (chunks.length === 0)
			return this.failPlan(
				importId,
				"No bank account is ready to import. Check Settings → Bank accounts.",
			);
		if (chunks.length > MAX_IMPORT_CHUNKS)
			return this.failPlan(
				importId,
				"This import is too big for one run. Try a shorter range.",
			);
		return { liveAccountIds: accounts.map((a) => a.id), chunks };
	}

	/** Fetches and reconciles one chunk. Never moves a mark or writes an anchor. */
	async importChunk(
		importId: number,
		{ accountId, accountName, from, to }: ImportChunk,
		liveAccountIds: string[],
	): Promise<ReconcileCounts> {
		if (!this.redbark)
			throw new CdrSyncError("Bank sync isn't set up", { retryable: false });
		let rows: SyncedTransaction[];
		try {
			rows = (
				await this.redbark.listTransactions({
					accountId,
					from: utcMidnight(from),
					to: utcMidnight(to),
				})
			).map((row) => mapRedbarkTransaction(row, accountName));
		} catch (cause) {
			throw syncError("cdr import chunk failed", [cause]);
		}
		// Not wrapped, so a database error retries the job; a bad bank row above won't.
		const counts = await this.transactions.reconcileSynced(rows, {
			liveAccountIds,
		});
		await this.repository.addImportCounts(importId, counts);
		return counts;
	}

	finishImport(importId: number): Promise<void> {
		return this.repository.finishImport(importId);
	}

	/** Once the job's retries run out. */
	failImport(importId: number): Promise<void> {
		return this.repository.failImport(importId, IMPORT_FAILED);
	}

	/** `reason` is shown to the member as the import's error. */
	private async failPlan(
		importId: number,
		reason: string,
	): Promise<ImportPlan> {
		await this.repository.failImport(importId, reason);
		return { liveAccountIds: [], chunks: [] };
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
		listed: { liveAccountIds: string[] },
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

		await this.syncAccount(redbark, account, highWaterMark, listed);
	}

	private async syncAccount(
		redbark: RedbarkClient,
		account: RedbarkAccount,
		mark: Date | null,
		listed: { liveAccountIds: string[] },
	): Promise<void> {
		const now = new Date();
		const from = new Date((mark ?? now).getTime() - OVERLAP_DAYS * DAY_MS);

		const rows = (
			await redbark.listTransactions({ accountId: account.id, from })
		).map((row) => mapRedbarkTransaction(row, account.name));
		await this.transactions.reconcileSynced(rows, listed);

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

/** What the daily sync would fetch today: listed, available, on a syncing consent. */
function isSyncable(
	account: RedbarkAccount | undefined,
	consent: CdrConnectionStatus | undefined,
): boolean {
	return (
		account?.status === "available" &&
		consent !== undefined &&
		isSyncingConsent(consent)
	);
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
