import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { createTestCaller } from "~/server/api/test-caller";
import { DrizzleMembersRepository } from "~/server/auth/members.repository";
import { MembersService } from "~/server/auth/members.service";
import { DrizzleCategoriesRepository } from "~/server/categories/categories.repository";
import { CategoriesService } from "~/server/categories/categories.service";
import { recordingDb, rowOf } from "~/server/db/recording-db.fake";
import { DrizzleExpensesRepository } from "~/server/expenses/expenses.repository";
import { ExpensesService } from "~/server/expenses/expenses.service";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import { DrizzleReceiptsRepository } from "~/server/receipts/receipts.repository";
import { receipts } from "~/server/receipts/receipts.schema";
import { ReceiptsService } from "~/server/receipts/receipts.service";
import { receiptRouter } from "~/server/receipts/receipts.trpc.controller";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";
import { unstaged } from "~/test/fakes";

// currentTraceId reads the ambient OTel span; stub it so the test asserts the id is
// threaded onto the insert, not whether a provider happens to be registered.
const { currentTraceId } = vi.hoisted(() => ({ currentTraceId: vi.fn() }));
vi.mock("~/server/observability/tracing/current-trace-id", () => ({
	currentTraceId,
}));

const door = { events: [] as OutboxEventDescriptor[] };

// The real service stack on the recording db. Stand-in write door: runs the writes
// in the test db's transaction and records the derived events, so the insert SQL
// lands in the snapshot. The real door is exercised in outbox/outbox.service.test.ts.
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
			outbox: {
				commit: (writes, events) =>
					db.transaction(async (tx) => {
						const result = await writes(tx as never);
						door.events.push(...events(result));
						return result;
					}),
				publish: unstaged,
			},
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

const input = {
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
};

function createDb(id: number) {
	return recordingDb((query) =>
		query.sql.startsWith("insert into")
			? [
					rowOf(RECEIPT_FIELDS, {
						id,
						status: ReceiptStatus.Pending,
						channel: ReceiptChannel.Upload,
						userId: "member-1",
						...input,
						traceId: "trace-abc",
						createdAt: new Date("2026-09-10T01:00:00.000Z"),
					}),
				]
			: new Error(`unexpected query: ${query.sql}`),
	);
}

beforeEach(() => {
	// The insert stamps createdAt/updatedAt with `new Date()`; pin it so the
	// snapshot's params don't drift.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T01:00:00.000Z"));
	door.events = [];
	currentTraceId.mockReset().mockReturnValue("trace-abc");
});

afterEach(() => vi.useRealTimers());

describe("receipt.create producer", () => {
	it("inserts one pending upload receipt in a transaction", async () => {
		const { db, queries } = createDb(42);

		const receipt = await caller(db).create(input);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "begin",
			  },
			  {
			    "method": "all",
			    "params": [
			      "pending",
			      "upload",
			      "member-1",
			      "https://blob.vercel-storage.com/receipt-abc.jpg",
			      "receipt-abc.jpg",
			      "image/jpeg",
			      "trace-abc",
			      "2026-09-10T01:00:00.000Z",
			      "2026-09-10T01:00:00.000Z",
			    ],
			    "sql": "insert into "receipt" ("id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, $5, $6, default, default, default, default, default, default, default, $7, default, default, $8, $9) returning "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
		expect(receipt.id).toBe(42);
	});

	it("owns the row to the session member, never the input", async () => {
		const { db, queries } = createDb(42);

		await caller(db).create({ ...input, userId: "intruder" } as never);

		const insert = queries.find((q) => q.sql.startsWith("insert into"));
		expect(insert?.params).toContain("member-1");
		expect(insert?.params).not.toContain("intruder");
	});

	it("stamps the ambient trace id on the row", async () => {
		const { db, queries } = createDb(42);

		await caller(db).create(input);

		const insert = queries.find((q) => q.sql.startsWith("insert into"));
		expect(insert?.params).toContain("trace-abc");
	});

	it("mints exactly one receipt/uploaded event carrying the row id as a number", async () => {
		const { db } = createDb(7);

		await caller(db).create(input);

		expect(door.events).toHaveLength(1);
		expect(door.events[0]?.name).toBe("receipt/uploaded");
		expect(door.events[0]?.data).toEqual({
			receiptId: 7,
			_trace: expect.any(Object),
		});
	});
});
