import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { DrizzleMembersRepository } from "~/server/auth/members.repository";
import { MembersService } from "~/server/auth/members.service";
import { DrizzleCategoriesRepository } from "~/server/categories/categories.repository";
import { CategoriesService } from "~/server/categories/categories.service";
import { recordingDb, rowOf } from "~/server/db/recording-db.fake";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import { DrizzleReceiptsRepository } from "~/server/receipts/receipts.repository";
import { receipts } from "~/server/receipts/receipts.schema";
import { ReceiptsService } from "~/server/receipts/receipts.service";
import { receiptRouter } from "~/server/receipts/receipts.trpc.controller";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";
import { unstaged } from "~/test/fakes";

const RECEIPT_FIELDS = Object.keys(getTableColumns(receipts));

const ROW = {
	id: 3,
	status: ReceiptStatus.Processed,
	channel: ReceiptChannel.Upload,
	userId: "user-1",
	blobUrl: "https://blob/r.jpg",
	blobPathname: "r.jpg",
	contentType: "image/jpeg",
	vendor: "Coles",
	receiptDate: "2026-09-10",
	total: 12.5,
	currency: "AUD",
	transactionId: 77,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	userName: "Sam",
	transactionDescription: "COLES 123",
};

// The WHERE the query is rendered with *is* the filter contract, and the bug this
// guards was an arm silently added to it — so the SQL text is the assertion.
function listDb() {
	return recordingDb(({ sql }) => {
		if (sql.includes('from "receipt"')) return [rowOf(RECEIPT_FIELDS, ROW)];
		if (sql.includes('from "user"')) return [[ROW.userId, ROW.userName]];
		if (sql.includes('from "transaction"'))
			return [[ROW.transactionId, ROW.transactionDescription]];
		return new Error(`unexpected query: ${sql}`);
	});
}

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

describe("receipt.list filters", () => {
	it("applies no predicate at all when neither filter is set", async () => {
		const { db, queries } = listDb();

		await caller(db).list(undefined);

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  "select "id", "name" from "user" where "user"."id" in ($1)",
			  "select "id", "description" from "transaction" where "transaction"."id" in ($1)",
			]
		`);
		expect(queries[0]?.sql).not.toContain(" where ");
	});

	// The regression: status used to silently AND `transactionId is null`, so a
	// matched receipt was unreachable through every value of the status dropdown.
	it("narrows by status only — matched receipts stay reachable", async () => {
		const { db, queries } = listDb();

		await caller(db).list({ status: ReceiptStatus.Processed });

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."status" = $1 order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  "select "id", "name" from "user" where "user"."id" in ($1)",
			  "select "id", "description" from "transaction" where "transaction"."id" in ($1)",
			]
		`);
		expect(queries[0]?.params).toEqual([ReceiptStatus.Processed]);
	});

	it("narrows to unmatched rows on its own, independent of status", async () => {
		const { db, queries } = listDb();

		await caller(db).list({ unmatchedOnly: true });

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."transactionId" is null order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  "select "id", "name" from "user" where "user"."id" in ($1)",
			  "select "id", "description" from "transaction" where "transaction"."id" in ($1)",
			]
		`);
		expect(queries[0]?.params).toEqual([]);
	});

	it("combines both when both are set — the to-do queue", async () => {
		const { db, queries } = listDb();

		await caller(db).list({
			status: ReceiptStatus.Processed,
			unmatchedOnly: true,
		});

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where ("receipt"."status" = $1 and "receipt"."transactionId" is null) order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  "select "id", "name" from "user" where "user"."id" in ($1)",
			  "select "id", "description" from "transaction" where "transaction"."id" in ($1)",
			]
		`);
		expect(queries[0]?.params).toEqual([ReceiptStatus.Processed]);
	});

	it("resolves the uploader and matched transaction names onto each row", async () => {
		const { db } = listDb();

		const [item] = await caller(db).list();

		expect(item).toMatchObject({
			id: 3,
			userName: "Sam",
			transactionDescription: "COLES 123",
		});
	});
});
