import { asc, count, eq, inArray } from "drizzle-orm";
import type {
	CategoryCount,
	Expense,
	ExpenseCreateInput,
	ExpenseUpdateInput,
} from "~/domain/expenses";
import type { db as realDb } from "~/server/db";
import { expenses } from "./expenses.schema";

export interface NameRow {
	id: number;
	name: string;
}

export interface ExpensesRepository {
	list(): Promise<Expense[]>;
	insert(values: ExpenseCreateInput): Promise<Expense | undefined>;
	/** `undefined` when no row has the id. */
	update(
		id: number,
		values: Omit<ExpenseUpdateInput, "id">,
	): Promise<Expense | undefined>;
	delete(id: number): Promise<void>;
	/** Ids with no row are absent from the result. */
	findNames(ids: number[]): Promise<NameRow[]>;
	/** A Category with no Expenses has no row. */
	countsByCategory(): Promise<CategoryCount[]>;
}

interface DrizzleExpensesRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleExpensesRepository implements ExpensesRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleExpensesRepositoryDeps) {
		this.db = db;
	}

	list(): Promise<Expense[]> {
		return this.db
			.select()
			.from(expenses)
			.orderBy(
				asc(expenses.categoryId),
				asc(expenses.sortOrder),
				asc(expenses.name),
			);
	}

	async insert(values: ExpenseCreateInput): Promise<Expense | undefined> {
		const [row] = await this.db.insert(expenses).values(values).returning();
		return row;
	}

	async update(
		id: number,
		values: Omit<ExpenseUpdateInput, "id">,
	): Promise<Expense | undefined> {
		const [row] = await this.db
			.update(expenses)
			.set(values)
			.where(eq(expenses.id, id))
			.returning();
		return row;
	}

	async delete(id: number): Promise<void> {
		await this.db.delete(expenses).where(eq(expenses.id, id));
	}

	findNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: expenses.id, name: expenses.name })
			.from(expenses)
			.where(inArray(expenses.id, ids));
	}

	countsByCategory(): Promise<CategoryCount[]> {
		return this.db
			.select({ categoryId: expenses.categoryId, count: count(expenses.id) })
			.from(expenses)
			.groupBy(expenses.categoryId);
	}
}
