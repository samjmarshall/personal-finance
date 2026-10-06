import { desc } from "drizzle-orm";
import type { BalanceSetInput, BalanceSnapshot } from "~/domain/balances";
import type { db as realDb } from "~/server/db";
import { balanceSnapshots } from "./balances.schema";

export interface BalancesRepository {
	/** `undefined` when there are no snapshots. */
	findLatest(): Promise<BalanceSnapshot | undefined>;
	insert(values: BalanceSetInput): Promise<BalanceSnapshot | undefined>;
}

interface DrizzleBalancesRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleBalancesRepository implements BalancesRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleBalancesRepositoryDeps) {
		this.db = db;
	}

	async findLatest(): Promise<BalanceSnapshot | undefined> {
		const [row] = await this.db
			.select()
			.from(balanceSnapshots)
			.orderBy(desc(balanceSnapshots.asOf), desc(balanceSnapshots.id))
			.limit(1);
		return row;
	}

	async insert(values: BalanceSetInput): Promise<BalanceSnapshot | undefined> {
		const [row] = await this.db
			.insert(balanceSnapshots)
			.values(values)
			.returning();
		return row;
	}
}
