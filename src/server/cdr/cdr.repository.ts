import { asc, eq, sql } from "drizzle-orm";
import type { BalanceSetInput } from "~/domain/balances";
import type { CdrSyncState } from "~/domain/cdr";
import type { CdrConnectionStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { cdrSyncState } from "./cdr.schema";

export type DiscoveredAccount = Pick<
	CdrSyncState,
	"accountId" | "accountNumber" | "connectionStatus" | "inBalance"
> & {
	connectionId: string;
	accountName: string;
	institutionName: string;
};

export interface CdrRepository {
	listSyncState(): Promise<CdrSyncState[]>;
	/** Inserts or refreshes the account; never touches its highWaterMark, a set inBalance or the nickname. */
	upsertAccount(account: DiscoveredAccount): Promise<void>;
	/** Never moves the mark back. Also stamps lastSyncedAt and clears lastError. */
	advanceHighWaterMark(
		accountId: string,
		mark: Date,
		syncedAt: Date,
	): Promise<void>;
	/** Every account on the connection. */
	setConnectionStatus(
		connectionId: string,
		status: CdrConnectionStatus,
	): Promise<void>;
	recordError(accountId: string, message: string): Promise<void>;
	/** `undefined` when no row has the account id. */
	setInBalance(
		accountId: string,
		inBalance: boolean,
	): Promise<CdrSyncState | undefined>;
	recordBalance(accountId: string, balance: BalanceSetInput): Promise<void>;
	/** Null clears it. `undefined` when no row has the account id. */
	setNickname(
		accountId: string,
		nickname: string | null,
	): Promise<CdrSyncState | undefined>;
}

interface DrizzleCdrRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleCdrRepository implements CdrRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleCdrRepositoryDeps) {
		this.db = db;
	}

	async listSyncState(): Promise<CdrSyncState[]> {
		return this.db.select().from(cdrSyncState).orderBy(asc(cdrSyncState.id));
	}

	async upsertAccount({
		accountId,
		connectionId,
		accountName,
		institutionName,
		accountNumber,
		connectionStatus,
		inBalance,
	}: DiscoveredAccount): Promise<void> {
		await this.db
			.insert(cdrSyncState)
			.values({
				accountId,
				connectionId,
				accountName,
				institutionName,
				accountNumber,
				connectionStatus,
				inBalance,
			})
			.onConflictDoUpdate({
				target: cdrSyncState.accountId,
				set: {
					connectionId,
					accountName,
					institutionName,
					accountNumber,
					connectionStatus,
					// Discovery fills the flag once; a member's choice is never overwritten.
					inBalance: sql`coalesce(${cdrSyncState.inBalance}, excluded."inBalance")`,
				},
			});
	}

	async advanceHighWaterMark(
		accountId: string,
		mark: Date,
		syncedAt: Date,
	): Promise<void> {
		await this.db
			.update(cdrSyncState)
			.set({
				// greatest() skips a null, so the first run just takes the new mark.
				highWaterMark: sql`greatest(${cdrSyncState.highWaterMark}, ${sql.param(mark, cdrSyncState.highWaterMark)})`,
				lastSyncedAt: syncedAt,
				lastError: null,
			})
			.where(eq(cdrSyncState.accountId, accountId));
	}

	async setConnectionStatus(
		connectionId: string,
		status: CdrConnectionStatus,
	): Promise<void> {
		await this.db
			.update(cdrSyncState)
			.set({ connectionStatus: status })
			.where(eq(cdrSyncState.connectionId, connectionId));
	}

	async recordError(accountId: string, message: string): Promise<void> {
		await this.db
			.update(cdrSyncState)
			.set({ lastError: message })
			.where(eq(cdrSyncState.accountId, accountId));
	}

	async setInBalance(
		accountId: string,
		inBalance: boolean,
	): Promise<CdrSyncState | undefined> {
		const [row] = await this.db
			.update(cdrSyncState)
			.set({ inBalance })
			.where(eq(cdrSyncState.accountId, accountId))
			.returning();
		return row;
	}

	async recordBalance(
		accountId: string,
		{ amount, asOf }: BalanceSetInput,
	): Promise<void> {
		await this.db
			.update(cdrSyncState)
			.set({ balance: amount, balanceAsOf: asOf })
			.where(eq(cdrSyncState.accountId, accountId));
	}

	async setNickname(
		accountId: string,
		nickname: string | null,
	): Promise<CdrSyncState | undefined> {
		const [row] = await this.db
			.update(cdrSyncState)
			.set({ nickname })
			.where(eq(cdrSyncState.accountId, accountId))
			.returning();
		return row;
	}
}
