import { asc, eq, sql } from "drizzle-orm";
import type { CdrSyncState } from "~/domain/cdr";
import type { CdrConnectionStatus } from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { cdrSyncState } from "./cdr.schema";

export type DiscoveredAccount = Pick<
	CdrSyncState,
	"accountId" | "connectionStatus"
> & {
	connectionId: string;
	accountName: string;
};

export interface CdrRepository {
	listSyncState(): Promise<CdrSyncState[]>;
	/** `undefined` when no row has the account id. */
	findSyncState(accountId: string): Promise<CdrSyncState | undefined>;
	/** Inserts or refreshes the account; never touches its highWaterMark. */
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

	async findSyncState(accountId: string): Promise<CdrSyncState | undefined> {
		const [row] = await this.db
			.select()
			.from(cdrSyncState)
			.where(eq(cdrSyncState.accountId, accountId));
		return row;
	}

	async upsertAccount({
		accountId,
		connectionId,
		accountName,
		connectionStatus,
	}: DiscoveredAccount): Promise<void> {
		await this.db
			.insert(cdrSyncState)
			.values({ accountId, connectionId, accountName, connectionStatus })
			.onConflictDoUpdate({
				target: cdrSyncState.accountId,
				set: { connectionId, accountName, connectionStatus },
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
}
