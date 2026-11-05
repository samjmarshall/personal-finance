import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ExpenseConsumption,
	PossibleDuplicateReview,
	Transaction,
	TransactionSummary,
} from "~/domain/transactions";
import { Frequency, Priority, Provenance } from "~/lib/constants";
import type { CategoriesService } from "~/server/categories/categories.service";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import type { ExpensesService } from "~/server/expenses/expenses.service";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import type {
	TransactionLink,
	TransactionsRepository,
} from "./transactions.repository";
import { TransactionsService } from "./transactions.service";

type ExpenseNames = Pick<ExpensesService, "namesByIds">;
type CategoryNames = Pick<CategoriesService, "namesByIds">;

function serviceWith(
	staged: Partial<TransactionsRepository>,
	stagedExpenses: Partial<ExpenseNames> = {},
	stagedCategories: Partial<CategoryNames> = {},
) {
	const repository: TransactionsRepository = {
		list: unstaged,
		summary: unstaged,
		insert: unstaged,
		findKnownExternalIds: unstaged,
		findReviews: unstaged,
		findMatchCandidates: unstaged,
		applyReconcile: unstaged,
		listPendingDuplicates: unstaged,
		countPendingDuplicates: unstaged,
		startApply: unstaged,
		takeApplyBatch: unstaged,
		applyAnswer: unstaged,
		releaseAnswer: unstaged,
		finishApply: unstaged,
		failApply: unstaged,
		latestApply: unstaged,
		findSyncedValues: unstaged,
		update: unstaged,
		findUnplanned: unstaged,
		findDescriptions: unstaged,
		listDescriptions: unstaged,
		findEmbeddings: unstaged,
		saveEmbeddings: unstaged,
		findInDateWindow: unstaged,
		findLink: unstaged,
		setLink: unstaged,
		delete: unstaged,
		consumedByExpense: unstaged,
		datedAmounts: unstaged,
		...staged,
	};
	const expenses: ExpenseNames = { namesByIds: unstaged, ...stagedExpenses };
	const categories: CategoryNames = {
		namesByIds: unstaged,
		...stagedCategories,
	};

	return new TransactionsService({ repository, expenses, categories });
}

const TRANSACTION: Transaction = {
	id: 1,
	expenseId: 7,
	categoryId: null,
	date: new Date("2026-09-01T00:00:00.000Z"),
	description: "Groceries",
	receiptDescription: null,
	amount: 42.5,
	group: "Food",
	frequency: Frequency.OneOff,
	priority: Priority.MustHave,
	notes: null,
	provenance: Provenance.Manual,
	externalId: null,
	externalAccountId: null,
	accountName: null,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
};

const FIELDS = {
	date: TRANSACTION.date,
	description: TRANSACTION.description,
	amount: TRANSACTION.amount,
};

// An edit reads the saved row first; a manual row may change amount and date.
const MANUAL_ROW: Pick<TransactionsRepository, "findSyncedValues"> = {
	findSyncedValues: async () => ({
		provenance: Provenance.Manual,
		amount: FIELDS.amount,
		date: FIELDS.date,
	}),
};

const FK_CONFLICT_MESSAGE =
	"The selected expense or category no longer exists.";

const EXPENSE_NAMES = new Map([[7, { name: "Weekly shop", categoryId: 3 }]]);
const LINKED: TransactionLink = { expenseId: 7, categoryId: null };

function writing(
	link?: TransactionLink,
	expenseNames: Awaited<ReturnType<ExpenseNames["namesByIds"]>> = EXPENSE_NAMES,
) {
	const written: unknown[][] = [];
	const service = serviceWith(
		{
			...MANUAL_ROW,
			findLink: async () => link,
			update: async (id, values) => {
				written.push([id, values]);

				return TRANSACTION;
			},
			setLink: async (id, values) => {
				written.push([id, values]);

				return TRANSACTION;
			},
		},
		{ namesByIds: async () => expenseNames },
	);

	return { service, written };
}

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

	it("clears the Category of a row linked to an Expense", async () => {
		const inserted: unknown[] = [];
		const service = serviceWith({
			insert: async (values) => {
				inserted.push(values);

				return TRANSACTION;
			},
		});

		await service.create({ ...FIELDS, expenseId: 5, categoryId: 3 });

		expect(inserted).toEqual([{ ...FIELDS, expenseId: 5, categoryId: null }]);
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

describe("possible duplicates", () => {
	const REVIEW: PossibleDuplicateReview = {
		id: 4,
		bank: {
			date: new Date("2026-10-15T00:00:00.000Z"),
			amount: 41,
			description: "WOOLIES",
			accountName: "Everyday",
		},
		mine: {
			id: 1,
			date: new Date("2026-10-14T13:00:00.000Z"),
			amount: 42.5,
			description: "Groceries",
			accountName: null,
			provenance: Provenance.Manual,
		},
		descriptionScore: 0.2,
		answer: null,
		notApplied: false,
	};

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-29T00:00:00.000Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	// A running Apply quiet for 15 min is dead, so its rows come back (adr032).
	it("lists and counts the pending reviews outside a live Apply", async () => {
		const since: Date[] = [];
		const service = serviceWith({
			listPendingDuplicates: async (activeSince) => {
				since.push(activeSince);

				return [REVIEW];
			},
			countPendingDuplicates: async (activeSince) => {
				since.push(activeSince);

				return 1;
			},
		});

		await expect(service.listPossibleDuplicates()).resolves.toEqual([REVIEW]);
		await expect(service.possibleDuplicateCount()).resolves.toBe(1);
		expect(since).toEqual([
			new Date("2026-09-28T23:45:00.000Z"),
			new Date("2026-09-28T23:45:00.000Z"),
		]);
	});
});

describe("update", () => {
	it("updates the row by id with the other fields", async () => {
		const updated: unknown[][] = [];
		const service = serviceWith({
			...MANUAL_ROW,
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
		const service = serviceWith({
			...MANUAL_ROW,
			update: async () => undefined,
		});

		const thrown = await service
			.update({ id: 1, ...FIELDS })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Transaction not found." });
	});

	it("turns a foreign-key violation into a ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ ...MANUAL_ROW, update: throwing(error) });

		const thrown = await service
			.update({ id: 1, ...FIELDS })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: FK_CONFLICT_MESSAGE,
			cause: error,
		});
	});

	it("turns a check violation into a ConflictError", async () => {
		const error = failedQuery("23514");
		const service = serviceWith({ ...MANUAL_ROW, update: throwing(error) });

		const thrown = await service
			.update({ id: 1, ...FIELDS, categoryId: 3 })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message:
				"A Transaction linked to an Expense takes its Category from the Expense.",
			cause: error,
		});
	});

	it("clears the Category when linking an Expense", async () => {
		const { service, written } = writing();

		await service.update({ id: 1, ...FIELDS, expenseId: 5, categoryId: 3 });

		expect(written).toEqual([
			[1, { ...FIELDS, expenseId: 5, categoryId: null }],
		]);
	});

	it("copies the Expense's Category when unlinking with no Category sent", async () => {
		const { service, written } = writing(LINKED);

		await service.update({ id: 1, ...FIELDS, expenseId: null });

		expect(written).toEqual([
			[1, { ...FIELDS, expenseId: null, categoryId: 3 }],
		]);
	});

	// No stored link is set up, so reading the old link before the write fails the test.
	it("keeps the Category sent when unlinking", async () => {
		const { service, written } = writing();

		await service.update({ id: 1, ...FIELDS, expenseId: null, categoryId: 4 });

		expect(written).toEqual([
			[1, { ...FIELDS, expenseId: null, categoryId: 4 }],
		]);
	});

	it("passes the Category through when expenseId is left out", async () => {
		const service = serviceWith({
			...MANUAL_ROW,
			update: async (_, values) => {
				expect(values).toEqual({ ...FIELDS, categoryId: 4 });

				return TRANSACTION;
			},
		});

		await expect(
			service.update({ id: 1, ...FIELDS, categoryId: 4 }),
		).resolves.toBe(TRANSACTION);
	});

	it("keeps an unlinked row's own Category when unlinking again", async () => {
		const { service, written } = writing({ expenseId: null, categoryId: 4 });

		await service.update({ id: 1, ...FIELDS, expenseId: null });

		expect(written).toEqual([
			[1, { ...FIELDS, expenseId: null, categoryId: 4 }],
		]);
	});

	it("gives no Category when unlinking from a deleted Expense", async () => {
		const { service, written } = writing(LINKED, new Map());

		await service.update({ id: 1, ...FIELDS, expenseId: null });

		expect(written).toEqual([
			[1, { ...FIELDS, expenseId: null, categoryId: null }],
		]);
	});

	it("throws NotFoundError when unlinking a missing row", async () => {
		const { service, written } = writing(undefined);

		const thrown = await service
			.update({ id: 1, ...FIELDS, expenseId: null })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Transaction not found." });
		expect(written).toEqual([]);
	});

	it("throws NotFoundError and writes nothing when the read finds no row", async () => {
		const service = serviceWith({ findSyncedValues: async () => undefined });

		const thrown = await service
			.update({ id: 1, ...FIELDS })
			.catch((e: unknown) => e);

		expect(thrown).toBeInstanceOf(NotFoundError);
		expect(thrown).toMatchObject({ message: "Transaction not found." });
	});

	describe("a synced row", () => {
		const SAVED = {
			provenance: Provenance.Cdr,
			amount: FIELDS.amount,
			date: FIELDS.date,
		};

		function syncedRow() {
			const written: unknown[] = [];
			const service = serviceWith({
				findSyncedValues: async () => SAVED,
				update: async (id, values) => {
					written.push([id, values]);

					return TRANSACTION;
				},
			});

			return { service, written };
		}

		it.each([
			["amount", { amount: 99 }],
			["date", { date: new Date("2026-09-02T00:00:00.000Z") }],
		])("refuses a changed %s and writes nothing", async (_, change) => {
			const { service, written } = syncedRow();

			const thrown = await service
				.update({ id: 1, ...FIELDS, ...change })
				.catch((e: unknown) => e);

			expect(thrown).toBeInstanceOf(InvalidInputError);
			expect(thrown).toMatchObject({
				message: "Amount and date come from the bank.",
			});
			expect(written).toEqual([]);
		});

		it("saves other edits when amount and date are unchanged", async () => {
			const { service, written } = syncedRow();

			await service.update({
				id: 1,
				...FIELDS,
				date: new Date(FIELDS.date),
				notes: "member note",
			});

			const { amount, date, ...rest } = FIELDS;
			expect(written).toEqual([[1, { ...rest, notes: "member note" }]]);
		});
	});

	it("lets a manual row change its amount and date", async () => {
		const { service, written } = writing();
		const change = { amount: 99, date: new Date("2026-09-02T00:00:00.000Z") };

		await service.update({ id: 1, ...FIELDS, ...change });

		expect(written).toEqual([[1, { ...FIELDS, ...change }]]);
	});
});

describe("linkExpense", () => {
	it("sets the expense on the row and clears its Category", async () => {
		const { service, written } = writing();

		await expect(service.linkExpense({ id: 1, expenseId: 7 })).resolves.toBe(
			TRANSACTION,
		);
		expect(written).toEqual([[1, { expenseId: 7, categoryId: null }]]);
	});

	it("copies the Expense's Category back when unlinking", async () => {
		const { service, written } = writing(LINKED);

		await service.linkExpense({ id: 1, expenseId: null });

		expect(written).toEqual([[1, { expenseId: null, categoryId: 3 }]]);
	});

	it("names only the expense in a foreign-key ConflictError", async () => {
		const error = failedQuery("23503");
		const service = serviceWith({ setLink: throwing(error) });

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
		const service = serviceWith({ setLink: async () => undefined });

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

	const CATEGORY_NAMES = new Map([
		[3, "Groceries"],
		[4, "Fuel"],
	]);

	const UNLINKED: Transaction = {
		...TRANSACTION,
		id: 2,
		expenseId: null,
		categoryId: null,
	};
	const OWN_CATEGORY: Transaction = { ...UNLINKED, id: 3, categoryId: 4 };

	function listing(
		items: Transaction[],
		{ expenseNames = EXPENSE_NAMES, categoryNames = CATEGORY_NAMES } = {},
	) {
		const queries: unknown[] = [];
		const asked: unknown[][] = [];
		const service = serviceWith(
			{
				list: async (query) => {
					queries.push(query);

					return { items, total: 9 };
				},
			},
			{
				namesByIds: async (ids) => {
					asked.push(["expenses", ids]);

					return expenseNames;
				},
			},
			{
				namesByIds: async (ids) => {
					asked.push(["categories", ids]);

					return categoryNames;
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

	it("asks each lookup once, with distinct ids", async () => {
		const { service, asked } = listing([
			TRANSACTION,
			{ ...TRANSACTION, id: 2 },
		]);

		await service.list(QUERY);

		expect(asked).toEqual([
			["expenses", [7]],
			["categories", [3]],
		]);
	});

	it("gives a null link a null name and never asks for it", async () => {
		const { service, asked } = listing([TRANSACTION, UNLINKED]);

		const { items } = await service.list(QUERY);

		expect(items[1]).toMatchObject({
			expenseName: null,
			categoryName: null,
		});
		expect(asked).toEqual([
			["expenses", [7]],
			["categories", [3]],
		]);
	});

	it("shows a linked row its Expense's Category", async () => {
		const { service } = listing([TRANSACTION]);

		const { items } = await service.list(QUERY);

		expect(items[0]).toMatchObject({
			categoryId: null,
			categoryName: "Groceries",
		});
	});

	it("shows an unlinked row its own Category", async () => {
		const { service } = listing([OWN_CATEGORY]);

		const { items } = await service.list(QUERY);

		expect(items[0]).toMatchObject({ categoryId: 4, categoryName: "Fuel" });
	});

	// Category 3 is known only once the expenses lookup returns, so it proves the order.
	it("asks categories after expenses, for the union of both kinds of row", async () => {
		const { service, asked } = listing([TRANSACTION, OWN_CATEGORY]);

		await service.list(QUERY);

		expect(asked).toEqual([
			["expenses", [7]],
			["categories", [3, 4]],
		]);
	});

	it("gives a null name for a Category id whose row is gone", async () => {
		const { service } = listing([OWN_CATEGORY], { categoryNames: new Map() });

		const { items } = await service.list(QUERY);

		expect(items[0]).toMatchObject({ categoryName: null });
	});

	it("asks with no ids for an empty page", async () => {
		const { service, asked } = listing([]);

		await expect(service.list(QUERY)).resolves.toEqual({
			items: [],
			total: 9,
		});
		expect(asked).toEqual([
			["expenses", []],
			["categories", []],
		]);
	});

	it("gives a null name for an id whose row is gone", async () => {
		const { service } = listing([TRANSACTION], {
			expenseNames: new Map(),
			categoryNames: new Map(),
		});

		const { items } = await service.list(QUERY);

		expect(items[0]).toMatchObject({
			expenseName: null,
			categoryName: null,
		});
	});

	const lookupError = new Error("connection lost");
	it.each([
		["expenses", { namesByIds: throwing(lookupError) }, {}],
		["categories", {}, { namesByIds: throwing(lookupError) }],
	])("lets a %s lookup error propagate", async (_, expenses, categories) => {
		const service = serviceWith(
			{ list: async () => ({ items: [TRANSACTION], total: 1 }) },
			{ namesByIds: async () => EXPENSE_NAMES, ...expenses },
			{ namesByIds: async () => CATEGORY_NAMES, ...categories },
		);

		await expect(service.list(QUERY)).rejects.toBe(lookupError);
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

	it("returns the repository's rows in the date window", async () => {
		const rows = [
			{
				id: 1,
				description: "Groceries",
				amount: 42.5,
				date: TRANSACTION.date,
			},
		];
		const windows: unknown[] = [];
		const service = serviceWith({
			findInDateWindow: async (window) => {
				windows.push(window);

				return rows;
			},
		});
		const window = {
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-15T00:00:00.000Z"),
		};

		await expect(service.inDateWindow(window)).resolves.toBe(rows);
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

describe("descriptionsByIds", () => {
	it("maps each found id to its description", async () => {
		const asked: number[][] = [];
		const service = serviceWith({
			findDescriptions: async (ids) => {
				asked.push(ids);

				return [{ id: 1, description: "Groceries" }];
			},
		});

		await expect(service.descriptionsByIds([1, 2])).resolves.toEqual(
			new Map([[1, "Groceries"]]),
		);
		expect(asked).toEqual([[1, 2]]);
	});

	it("skips the query for no ids", async () => {
		const service = serviceWith({});

		await expect(service.descriptionsByIds([])).resolves.toEqual(new Map());
	});
});
