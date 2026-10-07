import { describe, expect, it } from "vitest";
import type { Expense } from "~/domain/expenses";
import type { ExpenseConsumption } from "~/domain/transactions";
import { CommitmentKind } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import type { TransactionsService } from "~/server/transactions/transactions.service";
import { recorder } from "~/test/fakes";
import type { ExpensesService } from "./expenses.service";
import { expenseRouter } from "./expenses.trpc.controller";

const router = createTRPCRouter({ expense: expenseRouter });

function callerWith(
	expenses: Partial<ExpensesService>,
	{
		transactions = {},
		session,
	}: { transactions?: Partial<TransactionsService>; session?: null } = {},
) {
	return createTestCaller(router, {
		services: { expenses, transactions },
		session,
	});
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

const FIELDS = { name: "Weekly shop", categoryId: 3 };

describe("expense router", () => {
	it("list returns the service's expenses", async () => {
		const { method } = recorder([EXPENSE]);

		await expect(callerWith({ list: method }).expense.list()).resolves.toEqual([
			EXPENSE,
		]);
	});

	it("consumption asks the transactions service, not the expenses one", async () => {
		const consumption: ExpenseConsumption[] = [
			{ expenseId: 7, consumed: 12.5 },
		];
		const { method, calls } = recorder(consumption);

		await expect(
			callerWith(
				{},
				{ transactions: { consumedByExpense: method } },
			).expense.consumption(),
		).resolves.toEqual(consumption);
		expect(calls).toEqual([[]]);
	});

	it("create hands the service the parsed input", async () => {
		const { method, calls } = recorder(EXPENSE);

		await expect(
			callerWith({ create: method }).expense.create(FIELDS),
		).resolves.toEqual(EXPENSE);
		expect(calls).toEqual([[FIELDS]]);
	});

	it("update hands the service the parsed input, id included", async () => {
		const { method, calls } = recorder(EXPENSE);
		const input = { id: 7, ...FIELDS, kind: CommitmentKind.Recurring };

		await expect(
			callerWith({ update: method }).expense.update(input),
		).resolves.toEqual(EXPENSE);
		expect(calls).toEqual([[input]]);
	});

	it("delete deletes by id and reports success", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }).expense.delete({ id: 7 }),
		).resolves.toEqual({ success: true });
		expect(calls).toEqual([[7]]);
	});

	it("surfaces update's missing-row error as INTERNAL_SERVER_ERROR", async () => {
		const update = async (): Promise<never> => {
			throw new Error("Failed to update expense.");
		};

		await expect(
			callerWith({ update }).expense.update({
				id: 7,
				...FIELDS,
				kind: CommitmentKind.Recurring,
			}),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update expense.",
		});
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder(undefined);

		await expect(
			callerWith({ delete: method }, { session: null }).expense.delete({
				id: 7,
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
