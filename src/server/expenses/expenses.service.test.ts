import { describe, expect, it } from "vitest";
import type { Category } from "~/domain/categories";
import type { Expense } from "~/domain/expenses";
import { CommitmentKind } from "~/lib/constants";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { ExpensesRepository } from "./expenses.repository";
import { ExpensesService } from "./expenses.service";

function serviceWith(staged: Partial<ExpensesRepository>) {
	const repository: ExpensesRepository = {
		list: unstaged,
		insert: unstaged,
		update: unstaged,
		delete: unstaged,
		listCategories: unstaged,
		nextCategorySortOrder: unstaged,
		insertCategory: unstaged,
		findCategory: unstaged,
		updateCategory: unstaged,
		reorderCategories: unstaged,
		countExpensesInCategory: unstaged,
		deleteCategory: unstaged,
		findExpenseNames: unstaged,
		findCategoryNames: unstaged,
		...staged,
	};
	return new ExpensesService({ repository });
}

const EXPENSE: Expense = {
	id: 7,
	name: "Weekly shop",
	category: "Food",
	kind: CommitmentKind.Recurring,
	fortnight: 200,
	month: 433,
	year: 5200,
	amount: null,
	expectedDate: null,
	dueDay: null,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const CATEGORY: Category = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const EXPENSE_FIELDS = { name: "Weekly shop", category: "Food" };
const NAME_TAKEN_MESSAGE = "A category with that name already exists.";

describe("expenses", () => {
	it("list returns the repository's expenses", async () => {
		const rows = [EXPENSE];
		const service = serviceWith({ list: async () => rows });

		await expect(service.list()).resolves.toBe(rows);
	});

	it("create inserts the input and returns the stored row", async () => {
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);
				return EXPENSE;
			},
		});

		await expect(service.create(EXPENSE_FIELDS)).resolves.toBe(EXPENSE);
		expect(inserted).toEqual([EXPENSE_FIELDS]);
	});

	it("create throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		expectPlainError(
			await service.create(EXPENSE_FIELDS).catch((e: unknown) => e),
			"Failed to create expense.",
		);
	});

	it("update updates the row by id with the other fields", async () => {
		const updated: unknown[][] = [];
		const service = serviceWith({
			update: async (id, values) => {
				updated.push([id, values]);
				return EXPENSE;
			},
		});
		const values = { ...EXPENSE_FIELDS, kind: CommitmentKind.Recurring };

		await expect(service.update({ id: 7, ...values })).resolves.toBe(EXPENSE);
		expect(updated).toEqual([[7, values]]);
	});

	it("update throws a plain Error, not NotFoundError, when no row matches", async () => {
		const service = serviceWith({ update: async () => undefined });

		expectPlainError(
			await service
				.update({
					id: 7,
					...EXPENSE_FIELDS,
					kind: CommitmentKind.Recurring,
				})
				.catch((e: unknown) => e),
			"Failed to update expense.",
		);
	});

	it("delete deletes by id", async () => {
		const deleted: number[] = [];
		const service = serviceWith({
			delete: async (id) => {
				deleted.push(id);
			},
		});

		await service.delete(7);

		expect(deleted).toEqual([7]);
	});
});

describe("listCategories", () => {
	it("returns the repository's categories", async () => {
		const rows = [{ ...CATEGORY, expenseCount: 2 }];
		const service = serviceWith({ listCategories: async () => rows });

		await expect(service.listCategories()).resolves.toBe(rows);
	});
});

describe("createCategory", () => {
	function creating(staged: Partial<ExpensesRepository> = {}) {
		const inserted: unknown[] = [];
		const service = serviceWith({
			nextCategorySortOrder: async () => 4,
			insertCategory: async (values) => {
				inserted.push(values);
				return CATEGORY;
			},
			...staged,
		});
		return { service, inserted };
	}

	it("trims the input and sorts the new category last", async () => {
		const { service, inserted } = creating();

		await expect(
			service.createCategory({
				name: "  Food ",
				description: " Groceries and takeaway ",
			}),
		).resolves.toBe(CATEGORY);
		expect(inserted).toEqual([
			{ name: "Food", description: "Groceries and takeaway", sortOrder: 4 },
		]);
	});

	it("stores a blank or missing description as null", async () => {
		const { service, inserted } = creating();

		await service.createCategory({ name: "Food", description: "   " });
		await service.createCategory({ name: "Food" });

		expect(inserted).toEqual([
			{ name: "Food", description: null, sortOrder: 4 },
			{ name: "Food", description: null, sortOrder: 4 },
		]);
	});

	it("turns a duplicate name into a ConflictError", async () => {
		const error = failedQuery("23505");
		const { service } = creating({ insertCategory: throwing(error) });

		const thrown = await service
			.createCategory({ name: "Food" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message: NAME_TAKEN_MESSAGE, cause: error });
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23503");
		const { service } = creating({ insertCategory: throwing(error) });

		await expect(service.createCategory({ name: "Food" })).rejects.toBe(error);
	});

	it("throws a plain Error when the insert returns no row", async () => {
		const { service } = creating({ insertCategory: async () => undefined });

		expectPlainError(
			await service.createCategory({ name: "Food" }).catch((e: unknown) => e),
			"Failed to create category.",
		);
	});
});

describe("updateCategory", () => {
	function updating(staged: Partial<ExpensesRepository> = {}) {
		const updated: unknown[][] = [];
		const service = serviceWith({
			findCategory: async () => CATEGORY,
			updateCategory: async (...args) => {
				updated.push(args);
				return CATEGORY;
			},
			...staged,
		});
		return { service, updated };
	}

	it("trims the input and hands over the existing name as previousName", async () => {
		const { service, updated } = updating();

		await expect(
			service.updateCategory({ id: 3, name: " Groceries ", description: "  " }),
		).resolves.toBe(CATEGORY);
		expect(updated).toEqual([
			[3, { name: "Groceries", description: null }, "Food"],
		]);
	});

	it("throws NotFoundError for a missing id and never updates", async () => {
		const { service, updated } = updating({
			findCategory: async () => undefined,
		});

		const thrown = await service
			.updateCategory({ id: 3, name: "Food" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Category not found." });
		expect(updated).toEqual([]);
	});

	it("turns a duplicate name into a ConflictError", async () => {
		const error = failedQuery("23505");
		const { service } = updating({ updateCategory: throwing(error) });

		const thrown = await service
			.updateCategory({ id: 3, name: "Groceries" })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message: NAME_TAKEN_MESSAGE, cause: error });
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23503");
		const { service } = updating({ updateCategory: throwing(error) });

		await expect(
			service.updateCategory({ id: 3, name: "Groceries" }),
		).rejects.toBe(error);
	});

	it("throws a plain Error when the update returns no row", async () => {
		const { service } = updating({ updateCategory: async () => undefined });

		expectPlainError(
			await service
				.updateCategory({ id: 3, name: "Food" })
				.catch((e: unknown) => e),
			"Failed to update category.",
		);
	});
});

describe("reorderCategories", () => {
	it("hands the repository the ids in order", async () => {
		const reordered: number[][] = [];
		const service = serviceWith({
			reorderCategories: async (ids) => {
				reordered.push(ids);
			},
		});

		await service.reorderCategories([3, 1, 2]);

		expect(reordered).toEqual([[3, 1, 2]]);
	});
});

describe("deleteCategory", () => {
	function deleting(count: number, staged: Partial<ExpensesRepository> = {}) {
		const counted: string[] = [];
		const deleted: number[] = [];
		const service = serviceWith({
			findCategory: async () => CATEGORY,
			countExpensesInCategory: async (name) => {
				counted.push(name);
				return count;
			},
			deleteCategory: async (id) => {
				deleted.push(id);
			},
			...staged,
		});
		return { service, counted, deleted };
	}

	it("throws NotFoundError for a missing id and never counts or deletes", async () => {
		const { service, counted, deleted } = deleting(0, {
			findCategory: async () => undefined,
		});

		const thrown = await service.deleteCategory(3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Category not found." });
		expect(counted).toEqual([]);
		expect(deleted).toEqual([]);
	});

	// Wrong grammar for one expense ("use"), kept to match the old message.
	it.each([
		[1, 'Cannot delete "Food" — 1 expense still use it.'],
		[2, 'Cannot delete "Food" — 2 expenses still use it.'],
	])("refuses while %i expense(s) use the name", async (count, message) => {
		const { service, counted, deleted } = deleting(count);

		const thrown = await service.deleteCategory(3).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({ message });
		expect((thrown as Error).cause).toBeUndefined();
		expect(counted).toEqual(["Food"]);
		expect(deleted).toEqual([]);
	});

	it("deletes by id once no expense uses it", async () => {
		const { service, deleted } = deleting(0);

		await service.deleteCategory(3);

		expect(deleted).toEqual([3]);
	});
});

describe("namesByIds", () => {
	it("asks each lookup for its ids and maps the rows by id", async () => {
		const asked: unknown[][] = [];
		const service = serviceWith({
			findExpenseNames: async (ids) => {
				asked.push(["expenses", ids]);
				return [{ id: 7, name: "Weekly shop" }];
			},
			findCategoryNames: async (ids) => {
				asked.push(["categories", ids]);
				return [{ id: 3, name: "Food" }];
			},
		});

		await expect(
			service.namesByIds({ expenseIds: [7, 8], categoryIds: [3] }),
		).resolves.toEqual({
			expenses: new Map([[7, "Weekly shop"]]),
			categories: new Map([[3, "Food"]]),
		});
		expect(asked).toEqual([
			["expenses", [7, 8]],
			["categories", [3]],
		]);
	});

	// The unstaged defaults throw, so a lookup run for no ids would fail here.
	it("skips the lookup for an empty id list", async () => {
		const service = serviceWith({
			findExpenseNames: async () => [{ id: 7, name: "Weekly shop" }],
		});

		await expect(
			service.namesByIds({ expenseIds: [7], categoryIds: [] }),
		).resolves.toEqual({
			expenses: new Map([[7, "Weekly shop"]]),
			categories: new Map(),
		});
		await expect(
			serviceWith({}).namesByIds({ expenseIds: [], categoryIds: [] }),
		).resolves.toEqual({ expenses: new Map(), categories: new Map() });
	});

	it("lets a lookup error propagate", async () => {
		const error = new Error("connection lost");
		const service = serviceWith({
			findExpenseNames: async () => [],
			findCategoryNames: throwing(error),
		});

		await expect(
			service.namesByIds({ expenseIds: [7], categoryIds: [3] }),
		).rejects.toBe(error);
	});
});
