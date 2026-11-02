import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { BalanceSetInput } from "~/domain/balances";
import type { CdrImport, CdrSyncState } from "~/domain/cdr";
import type { ReconcileCounts } from "~/domain/transactions";
import {
	type CdrConnectionStatus,
	CdrImportStatus,
	UNFINISHED_IMPORT_STATUSES,
} from "~/lib/constants";
import type { db as realDb } from "~/server/db";
import { buildOutboxEvent } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { cdrImport, cdrSyncState } from "./cdr.schema";

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
	/** Saves the row and its start event in one write. */
	insertImport(
		range: Pick<CdrImport, "fromDate" | "toDate">,
	): Promise<CdrImport>;
	/** A queued or running import created after `since`. */
	findActiveImport(since: Date): Promise<CdrImport | undefined>;
	latestImport(): Promise<CdrImport | undefined>;
	/** Moves a queued or running import to running and returns it; `undefined` when it already finished. */
	markImportRunning(id: number): Promise<CdrImport | undefined>;
	addImportCounts(id: number, counts: ReconcileCounts): Promise<void>;
	/** Moves only a running import to done. */
	finishImport(id: number): Promise<void>;
	/** Fails only a queued or running import. */
	failImport(id: number, message: string): Promise<void>;
}

interface DrizzleCdrRepositoryDeps {
	db: typeof realDb;
	outbox: OutboxWriteDoor;
}

export class DrizzleCdrRepository implements CdrRepository {
	private readonly db: typeof realDb;
	private readonly outbox: OutboxWriteDoor;

	constructor({ db, outbox }: DrizzleCdrRepositoryDeps) {
		this.db = db;
		this.outbox = outbox;
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

	// The event carries the row id, known only after the insert, so row and event
	// commit together.
	async insertImport({
		fromDate,
		toDate,
	}: Pick<CdrImport, "fromDate" | "toDate">): Promise<CdrImport> {
		const [row] = await this.outbox.commit(
			(tx) => tx.insert(cdrImport).values({ fromDate, toDate }).returning(),
			(inserted) =>
				inserted.map((row) =>
					buildOutboxEvent("cdr/import.requested", { importId: row.id }),
				),
		);
		if (!row) throw new Error("insertImport: no row returned");
		return row;
	}

	async findActiveImport(since: Date): Promise<CdrImport | undefined> {
		const [row] = await this.db
			.select()
			.from(cdrImport)
			.where(
				and(
					inArray(cdrImport.status, UNFINISHED_IMPORT_STATUSES),
					gt(cdrImport.createdAt, since),
				),
			)
			.limit(1);
		return row;
	}

	async latestImport(): Promise<CdrImport | undefined> {
		const [row] = await this.db
			.select()
			.from(cdrImport)
			.orderBy(desc(cdrImport.id))
			.limit(1);
		return row;
	}

	async markImportRunning(id: number): Promise<CdrImport | undefined> {
		const [row] = await this.db
			.update(cdrImport)
			.set({ status: CdrImportStatus.Running })
			// Running too: a retried claim step must find its own claim, not quit with it stuck.
			.where(
				and(
					eq(cdrImport.id, id),
					inArray(cdrImport.status, UNFINISHED_IMPORT_STATUSES),
				),
			)
			.returning();
		return row;
	}

	async addImportCounts(
		id: number,
		{ added, adopted, flagged, known }: ReconcileCounts,
	): Promise<void> {
		await this.db
			.update(cdrImport)
			.set({
				added: sql`${cdrImport.added} + ${added}`,
				adopted: sql`${cdrImport.adopted} + ${adopted}`,
				flagged: sql`${cdrImport.flagged} + ${flagged}`,
				known: sql`${cdrImport.known} + ${known}`,
			})
			.where(eq(cdrImport.id, id));
	}

	async finishImport(id: number): Promise<void> {
		await this.db
			.update(cdrImport)
			.set({ status: CdrImportStatus.Done, finishedAt: new Date() })
			.where(
				and(
					eq(cdrImport.id, id),
					eq(cdrImport.status, CdrImportStatus.Running),
				),
			);
	}

	async failImport(id: number, message: string): Promise<void> {
		await this.db
			.update(cdrImport)
			.set({
				status: CdrImportStatus.Failed,
				error: message,
				finishedAt: new Date(),
			})
			.where(
				and(
					eq(cdrImport.id, id),
					inArray(cdrImport.status, UNFINISHED_IMPORT_STATUSES),
				),
			);
	}
}
