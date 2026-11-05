import { describe, expect, it } from "vitest";
import type {
	CurrentApply,
	Transaction,
	TransactionSummary,
} from "~/domain/transactions";
import {
	Answer,
	DuplicateApplyStatus,
	Frequency,
	Priority,
	Provenance,
} from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { ConflictError, NotFoundError } from "~/server/errors/domain-errors";
import { recorder, throwing } from "~/test/fakes";
import type { DuplicateApplyService } from "./duplicate-apply.service";
import type { TransactionsService } from "./transactions.service";
import { transactionRouter } from "./transactions.trpc.controller";

const router = createTRPCRouter({ transaction: transactionRouter });

function callerWith(
	transactions: Partial<TransactionsService>,
	session?: null,
) {
	return createTestCaller(router, { services: { transactions }, session });
}

function applyCallerWith(
	duplicateApply: Partial<DuplicateApplyService>,
	session?: null,
) {
	return createTestCaller(router, { services: { duplicateApply }, session });
}

const APPLY: CurrentApply = {
	id: 7,
	active: true,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	error: null,
	finishedAt: null,
	gone: 0,
	pending: 2,
	applied: 0,
	status: DuplicateApplyStatus.Running,
	taken: 0,
	total: 2,
	updatedAt: new Date("2026-09-01T01:00:00.000Z"),
};

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
			topGroups: [],
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

	it("possibleDuplicates and possibleDuplicateCount read the pending reviews", async () => {
		const list = recorder([]);
		const count = recorder(2);
		const caller = callerWith({
			listPossibleDuplicates: list.method,
			possibleDuplicateCount: count.method,
		});

		await expect(caller.transaction.possibleDuplicates()).resolves.toEqual([]);
		await expect(caller.transaction.possibleDuplicateCount()).resolves.toBe(2);
		expect([list.calls, count.calls]).toEqual([[[]], [[]]]);
	});

	it("applyAnswers hands the service the Answers and returns the new Apply", async () => {
		const { method, calls } = recorder(APPLY);
		const answers = [
			{ id: 4, answer: Answer.UseBank },
			{ id: 5, answer: Answer.KeepMine },
		];

		await expect(
			applyCallerWith({ start: method }).transaction.applyAnswers({ answers }),
		).resolves.toEqual(APPLY);
		expect(calls).toEqual([[{ answers }]]);
	});

	it("applyAnswers refuses an unknown Answer before reaching the service", async () => {
		const { method, calls } = recorder(APPLY);

		await expect(
			applyCallerWith({ start: method }).transaction.applyAnswers({
				answers: [{ id: 4, answer: "merge" as never }],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("applyAnswers surfaces a running Apply as CONFLICT", async () => {
		const start = throwing(new ConflictError("An apply is already running."));

		await expect(
			applyCallerWith({ start }).transaction.applyAnswers({
				answers: [{ id: 4, answer: Answer.KeepMine }],
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "An apply is already running.",
		});
	});

	it("rejects a signed-out applyAnswers before reaching the service", async () => {
		const { method, calls } = recorder(APPLY);

		await expect(
			applyCallerWith({ start: method }, null).transaction.applyAnswers({
				answers: [{ id: 4, answer: Answer.KeepMine }],
			}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});

	it("currentApply returns the service's Apply", async () => {
		const { method, calls } = recorder(APPLY);

		await expect(
			applyCallerWith({ current: method }).transaction.currentApply(),
		).resolves.toEqual(APPLY);
		expect(calls).toEqual([[]]);
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
