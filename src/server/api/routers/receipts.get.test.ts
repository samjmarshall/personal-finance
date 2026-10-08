import { getTableColumns } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { DrizzleMembersRepository } from "~/server/auth/members.repository";
import { MembersService } from "~/server/auth/members.service";
import { DrizzleCategoriesRepository } from "~/server/categories/categories.repository";
import { CategoriesService } from "~/server/categories/categories.service";
import {
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

// The env pair receipts.module.ts reads. No project id by default, so no trace
// link; a case sets one.
const env = {
	POSTHOG_UI_HOST: "https://us.posthog.com",
	POSTHOG_PROJECT_ID: undefined as string | undefined,
};

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
		posthogUi: {
			uiHost: env.POSTHOG_UI_HOST,
			projectId: env.POSTHOG_PROJECT_ID,
		},
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
	contentHash: null,
	vendor: "Coles",
	receiptDate: "2026-09-10",
	total: 12.5,
	currency: "AUD",
	rawJson: null,
	error: null,
	traceId: null as string | null,
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
	const respond: Respond = ({ sql }) => {
		if (sql.includes('from "receipt" '))
			return receipt ? [rowOf(RECEIPT_FIELDS, receipt)] : [];
		if (sql.includes('from "receipt_item"'))
			return items.map((item) => rowOf(ITEM_FIELDS, item));
		if (sql.includes('from "transaction"'))
			return receipt
				? [[receipt.transactionId, receipt.transactionDescription]]
				: [];
		if (sql.includes('from "expense"'))
			return items
				.filter((item) => item.expenseName)
				.map((item) => [item.expenseId, item.expenseName, null]);
		if (sql.includes('from "category"'))
			return items
				.filter((item) => item.categoryName)
				.map((item) => [item.categoryId, item.categoryName]);
		return new Error(`unexpected query: ${sql}`);
	};
	return recordingDb(respond);
}

beforeEach(() => {
	env.POSTHOG_PROJECT_ID = undefined;
});

describe("receipt.get", () => {
	it("selects the receipt, then its items with their resolved labels", async () => {
		const { db, queries } = getDb(RECEIPT, [ITEM]);

		await caller(db).get({ id: 3 });

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."id" = $1",
			  "select "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt" from "receipt_item" where "receipt_item"."receiptId" = $1 order by "receipt_item"."id" asc",
			  "select "id", "description" from "transaction" where "transaction"."id" in ($1)",
			  "select "id", "name" from "category" where "category"."id" in ($1)",
			]
		`);
		expect(queries.map((q) => q.params)).toEqual([[3], [3], [77], [2]]);
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

	it("builds the PostHog trace link when a project id and trace id are set", async () => {
		env.POSTHOG_PROJECT_ID = "42";
		const { db } = getDb({ ...RECEIPT, traceId: "trace-abc" }, []);

		const detail = await caller(db).get({ id: 3 });

		expect(detail.traceUrl).toBe(
			"https://us.posthog.com/project/42/tracing?trace=trace-abc",
		);
	});

	it("gives no trace link without a project id", async () => {
		const { db } = getDb({ ...RECEIPT, traceId: "trace-abc" }, []);

		const detail = await caller(db).get({ id: 3 });

		expect(detail.traceUrl).toBeNull();
	});

	it("404s when the receipt is gone, without reading its items", async () => {
		const { db, queries } = getDb(null, []);

		await expect(caller(db).get({ id: 3 })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found.",
		});
		expect(queries).toHaveLength(1);
	});
});
