import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Category } from "~/domain/categories";
import type {
	Expense,
	ExpenseCreateInput,
	ExpenseUpdateInput,
} from "~/domain/expenses";
import type { db as realDb } from "~/server/db";
import { categories } from "./categories.schema";
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
	/** Each carries `expenseCount`: the Expenses filed under it. */
	listCategories(): Promise<Category[]>;
	/** One past the highest `sortOrder`; 0 when there are none. */
	nextCategorySortOrder(): Promise<number>;
	insertCategory(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined>;
	findCategory(id: number): Promise<Category | undefined>;
	/** `undefined` when no row has the id. */
	updateCategory(
		id: number,
		values: CategoryValues,
	): Promise<Category | undefined>;
	/** Each id's `sortOrder` becomes its position in `ids`. */
	reorderCategories(ids: number[]): Promise<void>;
	countExpensesInCategory(categoryId: number): Promise<number>;
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

	listCategories(): Promise<Category[]> {
		return this.db
			.select({
				id: categories.id,
				name: categories.name,
				description: categories.description,
				sortOrder: categories.sortOrder,
				createdAt: categories.createdAt,
				updatedAt: categories.updatedAt,
				expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number),
			})
			.from(categories)
			.leftJoin(expenses, eq(expenses.categoryId, categories.id))
			.groupBy(categories.id)
			.orderBy(asc(categories.sortOrder), asc(categories.name));
	}

	// MAX, not count: deletes can leave gaps, so count would collide.
	async nextCategorySortOrder(): Promise<number> {
		const [next] = await this.db
			.select({
				sortOrder:
					sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)`.mapWith(
						Number,
					),
			})
			.from(categories);
		return next?.sortOrder ?? 0;
	}

	async insertCategory(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined> {
		const [row] = await this.db.insert(categories).values(values).returning();
		return row;
	}

	async findCategory(id: number): Promise<Category | undefined> {
		const [row] = await this.db
			.select()
			.from(categories)
			.where(eq(categories.id, id));
		return row;
	}

	async updateCategory(
		id: number,
		values: CategoryValues,
	): Promise<Category | undefined> {
		const [row] = await this.db
			.update(categories)
			.set(values)
			.where(eq(categories.id, id))
			.returning();
		return row;
	}

	async reorderCategories(ids: number[]): Promise<void> {
		await this.db.transaction(async (tx) => {
			for (const [index, id] of ids.entries()) {
				await tx
					.update(categories)
					.set({ sortOrder: index })
					.where(eq(categories.id, id));
			}
		});
	}

	async countExpensesInCategory(categoryId: number): Promise<number> {
		const [countRow] = await this.db
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(expenses)
			.where(eq(expenses.categoryId, categoryId));
		return countRow?.count ?? 0;
	}

	async deleteCategory(id: number): Promise<void> {
		await this.db.delete(categories).where(eq(categories.id, id));
	}

	findExpenseNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: expenses.id, name: expenses.name })
			.from(expenses)
			.where(inArray(expenses.id, ids));
	}

	findCategoryNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: categories.id, name: categories.name })
			.from(categories)
			.where(inArray(categories.id, ids));
	}
}
