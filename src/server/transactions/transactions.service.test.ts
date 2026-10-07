import { describe, expect, it } from "vitest";
import type {
	ExpenseConsumption,
	Transaction,
	TransactionSummary,
} from "~/domain/transactions";
import { Frequency, Priority } from "~/lib/constants";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import type {
	ExpensesService,
	NamesById,
} from "~/server/expenses/expenses.service";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import type { TransactionsRepository } from "./transactions.repository";
import { TransactionsService } from "./transactions.service";

type ExpenseNames = Pick<ExpensesService, "namesByIds">;

function serviceWith(
	staged: Partial<TransactionsRepository>,
	stagedExpenses: Partial<ExpenseNames> = {},
) {
	const repository: TransactionsRepository = {
		list: unstaged,
		summary: unstaged,
		insert: unstaged,
		update: unstaged,
		findUnplanned: unstaged,
		setExpense: unstaged,
		delete: unstaged,
		consumedByExpense: unstaged,
		datedAmounts: unstaged,
		...staged,
	};
	const expenses: ExpenseNames = { namesByIds: unstaged, ...stagedExpenses };
	return new TransactionsService({ repository, expenses });
}

const TRANSACTION: Transaction = {
	id: 1,
	expenseId: 7,
	categoryId: 3,
	date: new Date("2026-09-01T00:00:00.000Z"),
	description: "Groceries",
	receiptDescription: null,
	amount: 42.5,
	group: "Food",
	frequency: Frequency.OneOff,
	priority: Priority.MustHave,
	notes: null,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const FIELDS = {
	date: TRANSACTION.date,
	description: TRANSACTION.description,
	amount: TRANSACTION.amount,
};

const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";

describe("create", () => {
	it("inserts the input and returns the stored row", async () => {
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);
				return TRANSACTION;
			},
		});

		await expect(service.create(FIELDS)).resolves.toBe(TRANSACTION);
		expect(inserted).toEqual([FIELDS]);
	});

	it("turns a foreign-key violation into a ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ insert: throwing(error) });

		const thrown = await service.create(FIELDS).catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: FK_CONFLICT_MESSAGE,
			cause: error,
		});
	});

	it("rethrows any other violation unchanged", async () => {
		const error = failedQuery("23505");
		const service = serviceWith({ insert: throwing(error) });

		await expect(service.create(FIELDS)).rejects.toBe(error);
	});

	it("throws a plain Error when the insert returns no row", async () => {
		const service = serviceWith({ insert: async () => undefined });

		const thrown = await service.create(FIELDS).catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to create transaction.");
	});
});

describe("update", () => {
	it("updates the row by id with the other fields", async () => {
		const updated: unknown[][] = [];
		const service = serviceWith({
			update: async (id, values) => {
				updated.push([id, values]);
				return TRANSACTION;
			},
		});

		await expect(service.update({ id: 1, ...FIELDS })).resolves.toBe(
			TRANSACTION,
		);
		expect(updated).toEqual([[1, FIELDS]]);
	});

	it("throws NotFoundError when no row matches the id", async () => {
		const service = serviceWith({ update: async () => undefined });

		const thrown = await service
			.update({ id: 1, ...FIELDS })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Transaction not found." });
	});

	it("turns a foreign-key violation into a ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ update: throwing(error) });

		const thrown = await service
			.update({ id: 1, ...FIELDS })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: FK_CONFLICT_MESSAGE,
			cause: error,
		});
	});
});

describe("linkExpense", () => {
	it("sets the expense on the row", async () => {
		const linked: unknown[][] = [];
		const service = serviceWith({
			setExpense: async (id, expenseId) => {
				linked.push([id, expenseId]);
				return TRANSACTION;
			},
		});

		await expect(service.linkExpense({ id: 1, expenseId: 7 })).resolves.toBe(
			TRANSACTION,
		);
		expect(linked).toEqual([[1, 7]]);
	});

	it("names only the expense in a foreign-key ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ setExpense: throwing(error) });

		const thrown = await service
			.linkExpense({ id: 1, expenseId: 7 })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: "The selected expense no longer exists.",
			cause: error,
		});
	});

	it("throws NotFoundError when no row matches the id", async () => {
		const service = serviceWith({ setExpense: async () => undefined });

		const thrown = await service
			.linkExpense({ id: 1, expenseId: 7 })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Transaction not found." });
	});
});

describe("delete", () => {
	it("deletes by id", async () => {
		const deleted: number[] = [];
		const service = serviceWith({
			delete: async (id) => {
				deleted.push(id);
			},
		});

		await service.delete(1);

		expect(deleted).toEqual([1]);
	});
});

describe("list", () => {
	const QUERY = {
		sortBy: "date",
		sortDir: "desc",
		limit: 50,
		offset: 0,
	} as const;

	const NAMES: NamesById = {
		expenses: new Map([[7, "Weekly shop"]]),
		categories: new Map([[3, "Groceries"]]),
	};

	const UNLINKED: Transaction = {
		...TRANSACTION,
		id: 2,
		expenseId: null,
		categoryId: null,
	};

	function listing(items: Transaction[], names: NamesById = NAMES) {
		const queries: unknown[] = [];
		const asked: unknown[] = [];
		const service = serviceWith(
			{
				list: async (query) => {
					queries.push(query);
					return { items, total: 9 };
				},
			},
			{
				namesByIds: async (ids) => {
					asked.push(ids);
					return names;
				},
			},
		);
		return { service, queries, asked };
	}

	it("merges the names onto each row and passes the total through", async () => {
		const { service, queries } = listing([TRANSACTION]);

		await expect(service.list(QUERY)).resolves.toEqual({
			items: [
				{
					...TRANSACTION,
					expenseName: "Weekly shop",
					categoryName: "Groceries",
				},
			],
			total: 9,
		});
		expect(queries).toEqual([QUERY]);
	});

	it("asks for the names once, with distinct ids", async () => {
		const { service, asked } = listing([
			TRANSACTION,
			{ ...TRANSACTION, id: 2 },
		]);

		await service.list(QUERY);

		expect(asked).toEqual([{ expenseIds: [7], categoryIds: [3] }]);
	});

	it("gives a null link a null name and never asks for it", async () => {
		const { service, asked } = listing([TRANSACTION, UNLINKED]);

		const { items } = await service.list(QUERY);

		expect(items[1]).toMatchObject({
			expenseName: null,
			categoryName: null,
		});
		expect(asked).toEqual([{ expenseIds: [7], categoryIds: [3] }]);
	});

	it("gives a null name for an id whose row is gone", async () => {
		const { service } = listing([TRANSACTION], {
			expenses: new Map(),
			categories: new Map(),
		});

		const { items } = await service.list(QUERY);

		expect(items[0]).toMatchObject({
			expenseName: null,
			categoryName: null,
		});
	});

	it("lets a namesByIds error propagate", async () => {
		const error = new Error("connection lost");
		const service = serviceWith(
			{ list: async () => ({ items: [TRANSACTION], total: 1 }) },
			{ namesByIds: throwing(error) },
		);

		await expect(service.list(QUERY)).rejects.toBe(error);
	});
});

describe("reads", () => {
	it("returns the repository's summary", async () => {
		const summary: TransactionSummary = {
			totals: { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority: [],
			byFrequency: [],
			byMonth: [],
			topGroups: [],
		};
		const service = serviceWith({ summary: async () => summary });

		await expect(service.summary()).resolves.toBe(summary);
	});

	it("returns the repository's unplanned rows for the window", async () => {
		const rows = [TRANSACTION];
		const windows: unknown[] = [];
		const service = serviceWith({
			findUnplanned: async (window) => {
				windows.push(window);
				return rows;
			},
		});
		const window = {
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-15T00:00:00.000Z"),
		};

		await expect(service.unplanned(window)).resolves.toBe(rows);
		expect(windows).toEqual([window]);
	});

	it("returns the repository's Consumed per Expense", async () => {
		const consumption: ExpenseConsumption[] = [
			{ expenseId: 7, consumed: 12.5 },
		];
		const service = serviceWith({
			consumedByExpense: async () => consumption,
		});

		await expect(service.consumedByExpense()).resolves.toBe(consumption);
	});

	it("returns the repository's dated amounts", async () => {
		const rows = [{ date: TRANSACTION.date, amount: TRANSACTION.amount }];
		const service = serviceWith({ datedAmounts: async () => rows });

		await expect(service.datedAmounts()).resolves.toBe(rows);
	});
});
