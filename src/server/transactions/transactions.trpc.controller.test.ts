import { describe, expect, it } from "vitest";
import type { Transaction, TransactionSummary } from "~/domain/transactions";
import { Frequency, Priority } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { NotFoundError } from "~/server/errors/domain-errors";
import { recorder } from "~/test/fakes";
import type { TransactionsService } from "./transactions.service";
import { transactionRouter } from "./transactions.trpc.controller";

const router = createTRPCRouter({ transaction: transactionRouter });

function callerWith(
	transactions: Partial<TransactionsService>,
	session?: null,
) {
	return createTestCaller(router, { services: { transactions }, session });
}

const TRANSACTION: Transaction = {
	id: 1,
	expenseId: 7,
	expenseCategoryId: 3,
	date: new Date("2026-09-01T00:00:00.000Z"),
	description: "Groceries",
	receiptDescription: null,
	amount: 42.5,
	category: "Food",
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

describe("transaction router", () => {
	it("list hands the service the query with the DTO defaults", async () => {
		const page = { items: [], total: 0 };
		const { method, calls } = recorder(page);

		await expect(
			callerWith({ list: method }).transaction.list({}),
		).resolves.toEqual(page);
		expect(calls).toEqual([
			[{ sortBy: "date", sortDir: "desc", limit: 50, offset: 0 }],
		]);
	});

	it("summary returns the service's summary", async () => {
		const summary: TransactionSummary = {
			totals: { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority: [],
			byFrequency: [],
			byMonth: [],
			topCategories: [],
		};
		const { method } = recorder(summary);

		await expect(
			callerWith({ summary: method }).transaction.summary(),
		).resolves.toEqual(summary);
	});

	it("create hands the service the parsed input", async () => {
		const { method, calls } = recorder(TRANSACTION);

		await expect(
			callerWith({ create: method }).transaction.create(FIELDS),
		).resolves.toEqual(TRANSACTION);
		expect(calls).toEqual([[FIELDS]]);
	});

	it("update hands the service the parsed input, id included", async () => {
		const { method, calls } = recorder(TRANSACTION);

		await expect(
			callerWith({ update: method }).transaction.update({ id: 1, ...FIELDS }),
		).resolves.toEqual(TRANSACTION);
		expect(calls).toEqual([[{ id: 1, ...FIELDS }]]);
	});

	it("unplanned hands the service the window", async () => {
		const window = {
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-15T00:00:00.000Z"),
		};
		const { method, calls } = recorder([TRANSACTION]);

		await expect(
			callerWith({ unplanned: method }).transaction.unplanned(window),
		).resolves.toEqual([TRANSACTION]);
		expect(calls).toEqual([[window]]);
	});

	it("unplanned rejects an inverted window before reaching the service", async () => {
		const { method, calls } = recorder([TRANSACTION]);

		await expect(
			callerWith({ unplanned: method }).transaction.unplanned({
				from: new Date("2026-09-15T00:00:00.000Z"),
				to: new Date("2026-09-01T00:00:00.000Z"),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("linkExpense hands the service the id and expense", async () => {
		const { method, calls } = recorder(TRANSACTION);

		await expect(
			callerWith({ linkExpense: method }).transaction.linkExpense({
				id: 1,
				expenseId: 7,
			}),
		).resolves.toEqual(TRANSACTION);
		expect(calls).toEqual([[{ id: 1, expenseId: 7 }]]);
	});

	it("delete deletes by id and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }).transaction.delete({ id: 1 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[1]]);
	});

	it("surfaces a NotFoundError as NOT_FOUND", async () => {
		const update = async (): Promise<never> => {
			throw new NotFoundError("Transaction not found.");
		};

		await expect(
			callerWith({ update }).transaction.update({ id: 1, ...FIELDS }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Transaction not found.",
		});
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder({ items: [], total: 0 });

		await expect(
			callerWith({ list: method }, null).transaction.list({}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
