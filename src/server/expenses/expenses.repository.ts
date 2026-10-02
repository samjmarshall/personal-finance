import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Category } from "~/domain/categories";
import type {
	Expense,
	ExpenseCreateInput,
	ExpenseUpdateInput,
} from "~/domain/expenses";
import type { db as realDb } from "~/server/db";
import { expenseCategories } from "./categories.schema";
import { expenses } from "./expenses.schema";

export type CategoryValues = Pick<Category, "name" | "description">;

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
	/** Each carries `expenseCount`: the Expenses filed under its name. */
	listCategories(): Promise<Category[]>;
	/** One past the highest `sortOrder`; 0 when there are none. */
	nextCategorySortOrder(): Promise<number>;
	insertCategory(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined>;
	findCategory(id: number): Promise<Category | undefined>;
	/** `undefined` when no row has the id. Rewrites Expenses on a rename. */
	updateCategory(
		id: number,
		values: CategoryValues,
		previousName: string,
	): Promise<Category | undefined>;
	/** Each id's `sortOrder` becomes its position in `ids`. */
	reorderCategories(ids: number[]): Promise<void>;
	countExpensesInCategory(name: string): Promise<number>;
	deleteCategory(id: number): Promise<void>;
	/** Ids with no row are absent from the result. */
	findExpenseNames(ids: number[]): Promise<NameRow[]>;
	/** Ids with no row are absent from the result. */
	findCategoryNames(ids: number[]): Promise<NameRow[]>;
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
				asc(expenses.category),
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

	listCategories(): Promise<Category[]> {
		return this.db
			.select({
				id: expenseCategories.id,
				name: expenseCategories.name,
				description: expenseCategories.description,
				sortOrder: expenseCategories.sortOrder,
				createdAt: expenseCategories.createdAt,
				updatedAt: expenseCategories.updatedAt,
				expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number),
			})
			.from(expenseCategories)
			.leftJoin(expenses, eq(expenses.category, expenseCategories.name))
			.groupBy(expenseCategories.id)
			.orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
	}

	// MAX, not count: deletes can leave gaps, so count would collide.
	async nextCategorySortOrder(): Promise<number> {
		const [next] = await this.db
			.select({
				sortOrder:
					sql<number>`coalesce(max(${expenseCategories.sortOrder}) + 1, 0)`.mapWith(
						Number,
					),
			})
			.from(expenseCategories);
		return next?.sortOrder ?? 0;
	}

	async insertCategory(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined> {
		const [row] = await this.db
			.insert(expenseCategories)
			.values(values)
			.returning();
		return row;
	}

	async findCategory(id: number): Promise<Category | undefined> {
		const [row] = await this.db
			.select()
			.from(expenseCategories)
			.where(eq(expenseCategories.id, id));
		return row;
	}

	async updateCategory(
		id: number,
		values: CategoryValues,
		previousName: string,
	): Promise<Category | undefined> {
		const [row] = await this.db.transaction(async (tx) => {
			// An Expense files its category by name text, so a rename must move
			// them in the same commit.
			if (values.name !== previousName) {
				await tx
					.update(expenses)
					.set({ category: values.name })
					.where(eq(expenses.category, previousName));
			}
			return tx
				.update(expenseCategories)
				.set(values)
				.where(eq(expenseCategories.id, id))
				.returning();
		});
		return row;
	}

	async reorderCategories(ids: number[]): Promise<void> {
		await this.db.transaction(async (tx) => {
			for (const [index, id] of ids.entries()) {
				await tx
					.update(expenseCategories)
					.set({ sortOrder: index })
					.where(eq(expenseCategories.id, id));
			}
		});
	}

	async countExpensesInCategory(name: string): Promise<number> {
		const [countRow] = await this.db
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(expenses)
			.where(eq(expenses.category, name));
		return countRow?.count ?? 0;
	}

	async deleteCategory(id: number): Promise<void> {
		await this.db.delete(expenseCategories).where(eq(expenseCategories.id, id));
	}

	findExpenseNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: expenses.id, name: expenses.name })
			.from(expenses)
			.where(inArray(expenses.id, ids));
	}

	findCategoryNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: expenseCategories.id, name: expenseCategories.name })
			.from(expenseCategories)
			.where(inArray(expenseCategories.id, ids));
	}
}
