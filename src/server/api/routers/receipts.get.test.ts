import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import {
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
// No project id, so `get` builds no trace link. The root logger re-exports
// LogLevel from ~/env, so the mock must carry it too.
vi.mock("~/env", () => ({
	env: {
		POSTHOG_UI_HOST: "https://us.posthog.com",
		PROJECT_NAME: "personal-finance",
		LOG_LEVEL: "info",
	},
	LogLevel: { DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" },
}));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

function caller(db: unknown) {
	return createCallerFactory(receiptRouter)({
		db,
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);
}

const RECEIPT_FIELDS = [
	...Object.keys(getTableColumns(receipts)),
	"transactionDescription",
];
const ITEM_FIELDS = [
	...Object.keys(getTableColumns(receiptItems)),
	"expenseName",
	"categoryName",
];

const RECEIPT = {
	id: 3,
	status: ReceiptStatus.Processed,
	channel: ReceiptChannel.Upload,
	userId: "user-1",
	blobUrl: "https://blob/r.jpg",
	blobPathname: "r.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: "Coles",
	receiptDate: "2026-09-10",
	total: 12.5,
	currency: "AUD",
	rawJson: null,
	error: null,
	traceId: null,
	transactionId: 77,
	duplicateOfId: null,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
	transactionDescription: "COLES 123",
};

const ITEM = {
	id: 5,
	receiptId: 3,
	name: "Milk",
	price: 3.99,
	quantity: 1,
	expenseId: null,
	categoryId: 2,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
	expenseName: null,
	categoryName: "Groceries",
};

function getDb(
	receipt: typeof RECEIPT | null,
	items: Record<string, unknown>[],
) {
	const respond: Respond = (query) => {
		if (query.sql.includes('from "receipt" left join'))
			return receipt ? [rowOf(RECEIPT_FIELDS, receipt)] : [];
		if (query.sql.includes('from "receipt_item"'))
			return items.map((item) => rowOf(ITEM_FIELDS, item));
		return new Error(`unexpected query: ${query.sql}`);
	};
	return recordingDb(respond);
}

describe("receipt.get", () => {
	it("selects the receipt, then its items with their resolved labels", async () => {
		const { db, queries } = getDb(RECEIPT, [ITEM]);

		await caller(db).get({ id: 3 });

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "receipt"."id", "receipt"."status", "receipt"."channel", "receipt"."userId", "receipt"."blobUrl", "receipt"."blobPathname", "receipt"."contentType", "receipt"."contentHash", "receipt"."vendor", "receipt"."receiptDate", "receipt"."total", "receipt"."currency", "receipt"."rawJson", "receipt"."error", "receipt"."traceId", "receipt"."transactionId", "receipt"."duplicateOfId", "receipt"."createdAt", "receipt"."updatedAt", "transaction"."description" from "receipt" left join "transaction" on "receipt"."transactionId" = "transaction"."id" where "receipt"."id" = $1",
			  "select "receipt_item"."id", "receipt_item"."receiptId", "receipt_item"."name", "receipt_item"."price", "receipt_item"."quantity", "receipt_item"."expenseId", "receipt_item"."categoryId", "receipt_item"."createdAt", "receipt_item"."updatedAt", "expense"."name", "category"."name" from "receipt_item" left join "expense" on "receipt_item"."expenseId" = "expense"."id" left join "category" on "receipt_item"."categoryId" = "category"."id" where "receipt_item"."receiptId" = $1 order by "receipt_item"."id" asc",
			]
		`);
	});

	it("returns an item's category name when it has one", async () => {
		const { db } = getDb(RECEIPT, [ITEM]);

		const detail = await caller(db).get({ id: 3 });

		expect(detail).toMatchObject({
			id: 3,
			transactionDescription: "COLES 123",
			traceUrl: null,
			items: [{ id: 5, categoryId: 2, categoryName: "Groceries" }],
		});
	});

	it("returns a null category name for an unattributed item", async () => {
		const { db } = getDb(RECEIPT, [
			{ ...ITEM, categoryId: null, categoryName: null },
		]);

		const detail = await caller(db).get({ id: 3 });

		expect(detail.items[0]).toMatchObject({
			categoryId: null,
			categoryName: null,
		});
	});

	it("404s when the receipt is gone", async () => {
		const { db, queries } = getDb(null, []);

		await expect(caller(db).get({ id: 3 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(queries).toHaveLength(1);
	});
});
