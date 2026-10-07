import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Category } from "~/domain/categories";
import type { db as realDb } from "~/server/db";
import { categories } from "./categories.schema";

export type CategoryValues = Pick<Category, "name" | "description">;

export interface NameRow {
	id: number;
	name: string;
}

export interface CategoriesRepository {
	list(): Promise<Category[]>;
	/** One past the highest `sortOrder`; 0 when there are none. */
	nextSortOrder(): Promise<number>;
	insert(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined>;
	find(id: number): Promise<Category | undefined>;
	/** `undefined` when no row has the id. */
	update(id: number, values: CategoryValues): Promise<Category | undefined>;
	/** Each id's `sortOrder` becomes its position in `ids`. */
	reorder(ids: number[]): Promise<void>;
	/** Throws a 23503 while an Expense still uses the id. */
	delete(id: number): Promise<void>;
	/** Ids with no row are absent from the result. */
	findNames(ids: number[]): Promise<NameRow[]>;
}

interface DrizzleCategoriesRepositoryDeps {
	db: typeof realDb;
}

export class DrizzleCategoriesRepository implements CategoriesRepository {
	private readonly db: typeof realDb;

	constructor({ db }: DrizzleCategoriesRepositoryDeps) {
		this.db = db;
	}

	list(): Promise<Category[]> {
		return this.db
			.select()
			.from(categories)
			.orderBy(asc(categories.sortOrder), asc(categories.name));
	}

	// MAX, not count: deletes can leave gaps, so count would collide.
	async nextSortOrder(): Promise<number> {
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

	async insert(
		values: CategoryValues & Pick<Category, "sortOrder">,
	): Promise<Category | undefined> {
		const [row] = await this.db.insert(categories).values(values).returning();
		return row;
	}

	async find(id: number): Promise<Category | undefined> {
		const [row] = await this.db
			.select()
			.from(categories)
			.where(eq(categories.id, id));
		return row;
	}

	async update(
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

	async reorder(ids: number[]): Promise<void> {
		await this.db.transaction(async (tx) => {
			for (const [index, id] of ids.entries()) {
				await tx
					.update(categories)
					.set({ sortOrder: index })
					.where(eq(categories.id, id));
			}
		});
	}

	async delete(id: number): Promise<void> {
		await this.db.delete(categories).where(eq(categories.id, id));
	}

	findNames(ids: number[]): Promise<NameRow[]> {
		return this.db
			.select({ id: categories.id, name: categories.name })
			.from(categories)
			.where(inArray(categories.id, ids));
	}
}
