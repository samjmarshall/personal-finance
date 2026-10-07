import { describe, expect, it } from "vitest";
import type { Expense } from "~/domain/expenses";
import { CommitmentKind } from "~/lib/constants";
import { ConflictError } from "~/server/errors/domain-errors";
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
		findNames: unstaged,
		countsByCategory: unstaged,
		...staged,
	};
	return new ExpensesService({ repository });
}

const EXPENSE: Expense = {
	id: 7,
	name: "Weekly shop",
	categoryId: 3,
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

const EXPENSE_FIELDS = { name: "Weekly shop", categoryId: 3 };
const CATEGORY_GONE_MESSAGE = "The selected category no longer exists.";

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

	it.each([
		["create", (service: ExpensesService) => service.create(EXPENSE_FIELDS)],
		[
			"update",
			(service: ExpensesService) =>
				service.update({
					id: 7,
					...EXPENSE_FIELDS,
					kind: CommitmentKind.Recurring,
				}),
		],
	])(
		"%s turns a missing category (23503) into a ConflictError",
		async (_, write) => {
			const error = failedQuery("23503");
			const service = serviceWith({
				insert: throwing(error),
				update: throwing(error),
			});

			const thrown = await write(service).catch((e: unknown) => e);

			expect(thrown).toBeInstanceOf(ConflictError);
			expect(thrown).toMatchObject({
				message: CATEGORY_GONE_MESSAGE,
				cause: error,
			});
		},
	);

	it("create and update rethrow any other error unchanged", async () => {
		const error = new Error("connection lost");
		const service = serviceWith({
			insert: throwing(error),
			update: throwing(error),
		});

		await expect(service.create(EXPENSE_FIELDS)).rejects.toBe(error);
		await expect(
			service.update({
				id: 7,
				...EXPENSE_FIELDS,
				kind: CommitmentKind.Recurring,
			}),
		).rejects.toBe(error);
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

describe("namesByIds", () => {
	it("asks the repository for the ids and maps the rows by id", async () => {
		const asked: number[][] = [];
		const service = serviceWith({
			findNames: async (ids) => {
				asked.push(ids);
				return [{ id: 7, name: "Weekly shop" }];
			},
		});

		await expect(service.namesByIds([7, 8])).resolves.toEqual(
			new Map([[7, "Weekly shop"]]),
		);
		expect(asked).toEqual([[7, 8]]);
	});

	// The unstaged default throws, so a lookup run for no ids would fail here.
	it("gives an empty map for no ids without querying", async () => {
		await expect(serviceWith({}).namesByIds([])).resolves.toEqual(new Map());
	});

	it("lets a lookup error propagate", async () => {
		const error = new Error("connection lost");
		const service = serviceWith({ findNames: throwing(error) });

		await expect(service.namesByIds([7])).rejects.toBe(error);
	});
});

describe("countsByCategory", () => {
	it("returns the repository's counts", async () => {
		const rows = [{ categoryId: 3, count: 2 }];
		const service = serviceWith({ countsByCategory: async () => rows });

		await expect(service.countsByCategory()).resolves.toBe(rows);
	});
});
