import type { TRPCError } from "@trpc/server";
import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchScanWindow } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { DrizzleMembersRepository } from "~/server/auth/members.repository";
import { MembersService } from "~/server/auth/members.service";
import { DrizzleCategoriesRepository } from "~/server/categories/categories.repository";
import { CategoriesService } from "~/server/categories/categories.service";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleReceiptsRepository } from "~/server/receipts/receipts.repository";
import { receiptItems, receipts } from "~/server/receipts/receipts.schema";
import { ReceiptsService } from "~/server/receipts/receipts.service";
import { receiptRouter } from "~/server/receipts/receipts.trpc.controller";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";
import { unstaged } from "~/test/fakes";

// The runner's own zone, so the local-midnight fixtures below resolve to the day
// they read as. Zone-shift behaviour itself is pinned in match.test.ts.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The real service stack on the recording db.
function caller(db: ReturnType<typeof recordingDb>["db"]) {
	const on = { db: db as never };
	const expenses = new ExpensesService({
		repository: new DrizzleExpensesRepository(on),
	});
	const categories = new CategoriesService({
		repository: new DrizzleCategoriesRepository(on),
	});
	const receipts = new ReceiptsService({
		repository: new DrizzleReceiptsRepository({
			...on,
			outbox: { commit: unstaged, publish: unstaged },
		}),
		members: new MembersService({
			repository: new DrizzleMembersRepository(on),
		}),
		transactions: new TransactionsService({
			repository: new DrizzleTransactionsRepository(on),
			expenses,
			categories,
		}),
		expenses,
		categories,
		blobStore: { delete: unstaged },
		posthogUi: { uiHost: "https://us.posthog.com" },
	});
	return createTestCaller(receiptRouter, { services: { receipts } });
}

const RECEIPT_FIELDS = Object.keys(getTableColumns(receipts));
const ITEM_FIELDS = Object.keys(getTableColumns(receiptItems));

const RECEIPT = {
	id: 3,
	status: ReceiptStatus.Processed,
	channel: ReceiptChannel.Upload,
	userId: "user-1",
	blobUrl: "https://blob/r.jpg",
	blobPathname: "r.jpg",
	contentType: "image/jpeg",
	transactionId: 77,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
};

const ITEM = {
	id: 5,
	receiptId: 3,
	name: "Milk",
	price: 3.99,
	quantity: 1,
	expenseId: 4,
	categoryId: 2,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
};

// Each write is one `update … returning`: it hands back `rows`, or throws `throws`
// the way the driver does — a DrizzleQueryError whose `.cause` is the pg error.
function updateDb(
	table: "receipt" | "receipt_item",
	outcome: { rows?: unknown[][]; throws?: Error },
) {
	const respond: Respond = (query) => {
		if (!query.sql.startsWith(`update "${table}"`))
			return new Error(`unexpected query: ${query.sql}`);
		return outcome.throws ?? outcome.rows ?? [];
	};
	return recordingDb(respond);
}

beforeEach(() => {
	// Each update stamps updatedAt with `new Date()`; pin it so the snapshots'
	// params don't drift.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("receipt.confirmMatch", () => {
	it("links the receipt to the chosen transaction", async () => {
		const { db, queries } = updateDb("receipt", {
			rows: [rowOf(RECEIPT_FIELDS, RECEIPT)],
		});

		const row = await caller(db).confirmMatch({
			receiptId: 3,
			transactionId: 77,
		});

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      77,
			      "2026-09-10T02:00:00.000Z",
			      3,
			    ],
			    "sql": "update "receipt" set "transactionId" = $1, "updatedAt" = $2 where "receipt"."id" = $3 returning "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt"",
			  },
			]
		`);
		expect(row).toMatchObject({ id: 3, transactionId: 77 });
	});

	it("maps the unique-index violation (23505) to CONFLICT — the dup-photo catcher", async () => {
		const { db } = updateDb("receipt", { throws: pgError("23505") });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That transaction already has a receipt.",
		});
	});

	it("maps a deleted transaction (23503) to CONFLICT", async () => {
		const { db } = updateDb("receipt", { throws: pgError("23503") });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That transaction no longer exists.",
		});
	});

	it("leaves a non-SQLSTATE failure a 500 that keeps the driver error", async () => {
		const driverError = new Error("connection lost");
		const { db } = updateDb("receipt", { throws: driverError });

		const thrown = await caller(db)
			.confirmMatch({ receiptId: 3, transactionId: 77 })
			.catch((error: unknown) => error);

		expect(thrown).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
		// tRPC wraps the query error, which wraps the driver's.
		expect((thrown as TRPCError).cause?.cause).toBe(driverError);
	});

	it("404s with the exact message when the receipt is gone", async () => {
		const { db } = updateDb("receipt", { rows: [] });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found.",
		});
	});
});

describe("receipt.setItemExpense", () => {
	it("attributes the item to an expense", async () => {
		const { db, queries } = updateDb("receipt_item", {
			rows: [rowOf(ITEM_FIELDS, ITEM)],
		});

		await caller(db).setItemExpense({ itemId: 5, expenseId: 4 });

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      4,
			      "2026-09-10T02:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "expenseId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("clears the link when the member picks none", async () => {
		const { db, queries } = updateDb("receipt_item", {
			rows: [rowOf(ITEM_FIELDS, { ...ITEM, expenseId: null })],
		});

		await caller(db).setItemExpense({ itemId: 5, expenseId: null });

		expect(queries[0]?.params).toEqual([null, "2026-09-10T02:00:00.000Z", 5]);
	});

	it("maps a vanished expense (23503) to CONFLICT", async () => {
		const { db } = updateDb("receipt_item", { throws: pgError("23503") });

		await expect(
			caller(db).setItemExpense({ itemId: 5, expenseId: 4 }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "The selected expense or category no longer exists.",
		});
	});

	it("404s with the exact message when the item is gone", async () => {
		const { db } = updateDb("receipt_item", { rows: [] });

		await expect(
			caller(db).setItemExpense({ itemId: 5, expenseId: 4 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt item not found.",
		});
	});
});

describe("receipt.setItemCategory", () => {
	it("attributes the item to a category", async () => {
		const { db, queries } = updateDb("receipt_item", {
			rows: [rowOf(ITEM_FIELDS, ITEM)],
		});

		await caller(db).setItemCategory({ itemId: 5, categoryId: 2 });

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      2,
			      "2026-09-10T02:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "categoryId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("clears the category when the member picks none", async () => {
		const { db, queries } = updateDb("receipt_item", {
			rows: [rowOf(ITEM_FIELDS, { ...ITEM, categoryId: null })],
		});

		await caller(db).setItemCategory({ itemId: 5, categoryId: null });

		expect(queries[0]?.params).toEqual([null, "2026-09-10T02:00:00.000Z", 5]);
	});

	it("maps a vanished category (23503) to CONFLICT", async () => {
		const { db } = updateDb("receipt_item", { throws: pgError("23503") });

		await expect(
			caller(db).setItemCategory({ itemId: 5, categoryId: 2 }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "The selected expense or category no longer exists.",
		});
	});

	it("404s with the exact message when the item is gone", async () => {
		const { db } = updateDb("receipt_item", { rows: [] });

		await expect(
			caller(db).setItemCategory({ itemId: 5, categoryId: 2 }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt item not found.",
		});
	});
});

const TX_FIELDS = ["id", "description", "amount", "date"];

// A row's `linkedReceiptId` marks a transaction that already has a receipt.
function matchDb(
	receipt: { total: number | null; receiptDate: string | null } | null,
	txRows: { id: number; linkedReceiptId: number | null }[],
) {
	const respond: Respond = ({ sql }) => {
		if (sql.includes('from "transaction"'))
			return txRows.map((row) => rowOf(TX_FIELDS, row));
		if (sql.startsWith('select "transactionId" from "receipt"'))
			return txRows
				.filter((row) => row.linkedReceiptId !== null)
				.map((row) => [row.id]);
		if (sql.includes('from "receipt"'))
			return receipt ? [rowOf(["total", "receiptDate"], receipt)] : [];
		return new Error(`unexpected query: ${sql}`);
	};
	return recordingDb(respond);
}

describe("receipt.matchCandidates", () => {
	const receipt = { total: 100, receiptDate: "2026-09-10" };
	const txRows = [
		{
			id: 1,
			description: "Coles",
			amount: 100,
			date: new Date(2026, 8, 10),
			linkedReceiptId: null,
		},
		{
			id: 2,
			description: "Woolworths",
			amount: 100,
			date: new Date(2026, 8, 10),
			linkedReceiptId: 8,
		},
		{
			id: 3,
			description: "Aldi",
			amount: 101,
			date: new Date(2026, 8, 10),
			linkedReceiptId: null,
		},
	];

	it("ranks the in-window transactions and drops ones already claimed", async () => {
		const { db, queries } = matchDb(receipt, txRows);

		const result = await caller(db).matchCandidates({
			receiptId: 3,
			timeZone: TZ,
		});

		expect(result.map((c) => c.id)).toEqual([1, 3]);
		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "total", "receiptDate" from "receipt" where "receipt"."id" = $1",
			  "select "id", "description", "amount", "date" from "transaction" where ("transaction"."date" >= $1 and "transaction"."date" < $2)",
			  "select "transactionId" from "receipt" where "receipt"."transactionId" in ($1, $2, $3)",
			]
		`);
		expect(queries[0]?.params).toEqual([3]);
	});

	it("scans the half-open [from, to) window around the receipt date", async () => {
		const { db, queries } = matchDb(receipt, txRows);

		await caller(db).matchCandidates({ receiptId: 3, timeZone: TZ });

		// Local-midnight bounds, so the expectation follows the runner's zone too.
		const window = matchScanWindow("2026-09-10");
		expect(queries[1]?.params).toEqual([
			window?.from.toISOString(),
			window?.to.toISOString(),
		]);
	});

	it.each([
		["total", { total: null, receiptDate: "2026-09-10" }],
		["receiptDate", { total: 100, receiptDate: null }],
	])("skips the transaction scan when the %s is null", async (_, partial) => {
		const { db, queries } = matchDb(partial, txRows);

		await expect(
			caller(db).matchCandidates({ receiptId: 3, timeZone: TZ }),
		).resolves.toEqual([]);
		expect(queries).toHaveLength(1);
	});

	it("404s with the exact message when the receipt is gone", async () => {
		const { db } = matchDb(null, []);

		await expect(
			caller(db).matchCandidates({ receiptId: 3, timeZone: TZ }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found.",
		});
	});
});
