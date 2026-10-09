import { asc, eq } from "drizzle-orm";
import type {
	Income,
	IncomeCreateInput,
	IncomeUpdateInput,
} from "~/domain/income";
import type { db as realDb } from "~/server/db";
import { income } from "./income.schema";

export interface IncomeRepository {
	list(): Promise<Income[]>;
	insert(values: IncomeCreateInput): Promise<Income | undefined>;
	/** `undefined` when no row has the id. */
	update(
		id: number,
		values: Omit<IncomeUpdateInput, "id">,
	): Promise<Income | undefined>;
	delete(id: number): Promise<void>;
}

interface DrizzleIncomeRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleIncomeRepository implements IncomeRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleIncomeRepositoryDeps) {
		this.db = db;
	}

	list(): Promise<Income[]> {
		return this.db
			.select()
			.from(income)
			.orderBy(asc(income.person), asc(income.sortOrder), asc(income.source));
	}

	async insert(values: IncomeCreateInput): Promise<Income | undefined> {
		const [row] = await this.db.insert(income).values(values).returning();
		return row;
	}

	async update(
		id: number,
		values: Omit<IncomeUpdateInput, "id">,
	): Promise<Income | undefined> {
		const [row] = await this.db
			.update(income)
			.set(values)
			.where(eq(income.id, id))
			.returning();
		return row;
	}

	async delete(id: number): Promise<void> {
		await this.db.delete(income).where(eq(income.id, id));
	}
}
