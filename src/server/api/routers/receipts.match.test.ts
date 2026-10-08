import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchScanWindow } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { receiptItems, receipts } from "~/server/receipts/receipts.schema";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

// The runner's own zone, so the local-midnight fixtures below resolve to the day
// they read as. Zone-shift behaviour itself is pinned in match.test.ts.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function caller(db: unknown) {
	return createCallerFactory(receiptRouter)({
		db,
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);
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

	it("leaves a non-SQLSTATE failure a 500, not a CONFLICT", async () => {
		const { db } = updateDb("receipt", {
			throws: new Error("connection lost"),
		});

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
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

// matchCandidates runs two selects: the receipt's match input, then the windowed
// transactions leftJoined to receipts (the linked flag).
const TX_FIELDS = ["id", "description", "amount", "date", "linkedReceiptId"];

function matchDb(
	receipt: { total: number | null; receiptDate: string | null } | null,
	txRows: Record<string, unknown>[],
) {
	const respond: Respond = (query) => {
		if (query.sql.includes('from "transaction"'))
			return txRows.map((row) => rowOf(TX_FIELDS, row));
		if (query.sql.includes('from "receipt"'))
			return receipt ? [rowOf(["total", "receiptDate"], receipt)] : [];
		return new Error(`unexpected query: ${query.sql}`);
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
			  "select "transaction"."id", "transaction"."description", "transaction"."amount", "transaction"."date", "receipt"."id" from "transaction" left join "receipt" on "receipt"."transactionId" = "transaction"."id" where ("transaction"."date" >= $1 and "transaction"."date" < $2)",
			]
		`);
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
