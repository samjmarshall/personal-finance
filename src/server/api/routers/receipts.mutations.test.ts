import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import { DrizzleReceiptsRepository } from "~/server/receipts/receipts.repository";
import { receipts } from "~/server/receipts/receipts.schema";
import { ReceiptsService } from "~/server/receipts/receipts.service";
import { receiptRouter } from "~/server/receipts/receipts.trpc.controller";
import { DrizzleTransactionsRepository } from "~/server/transactions/transactions.repository";
import { TransactionsService } from "~/server/transactions/transactions.service";
import { unstaged } from "~/test/fakes";

// currentTraceId reads the ambient OTel span; stub it so retry's trace-id overwrite
// is asserted directly rather than depending on a registered provider.
const { currentTraceId } = vi.hoisted(() => ({ currentTraceId: vi.fn() }));
vi.mock("~/server/observability/tracing/current-trace-id", () => ({
	currentTraceId,
}));

const door = { events: [] as OutboxEventDescriptor[] };
// The blob delete is the only external I/O in delete; assert it gets the stored pathname.
const del = vi.fn();

// The real service stack on the recording db. Stand-in write door: runs the writes
// in the test db's transaction and records the derived events, so the update SQL and
// its begin/commit/rollback land in the snapshot. The real door is exercised in
// outbox/outbox.service.test.ts.
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
		blobStore: { delete: del },
		posthogUi: { uiHost: "https://us.posthog.com" },
	});
	return createTestCaller(receiptRouter, { services: { receipts } });
}

const RECEIPT_FIELDS = Object.keys(getTableColumns(receipts));

const FAILED = {
	id: 9,
	status: ReceiptStatus.Pending,
	channel: ReceiptChannel.Upload,
	userId: "user-1",
	blobUrl: "https://blob/r.jpg",
	blobPathname: "r.jpg",
	contentType: "image/jpeg",
	traceId: "trace-retry",
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
};

beforeEach(() => {
	// retry stamps updatedAt with `new Date()`; pin it so the snapshot's params
	// don't drift.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"));
	door.events = [];
	del.mockReset();
	currentTraceId.mockReset().mockReturnValue("trace-retry");
});
afterEach(() => vi.useRealTimers());

describe("receipt.retry", () => {
	// The guarded update returns the row only while it is still `failed`.
	function retryDb(updated: boolean) {
		return recordingDb((query) =>
			query.sql.startsWith("update")
				? updated
					? [rowOf(RECEIPT_FIELDS, FAILED)]
					: []
				: new Error(`unexpected query: ${query.sql}`),
		);
	}

	it("flips a failed receipt to pending, overwrites the trace id and clears the error, in one transaction", async () => {
		const { db, queries } = retryDb(true);

		await caller(db).retry({ id: 9 });

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
			      null,
			      "trace-retry",
			      "2026-09-10T02:00:00.000Z",
			      9,
			      "failed",
			    ],
			    "sql": "update "receipt" set "status" = $1, "error" = $2, "traceId" = $3, "updatedAt" = $4 where ("receipt"."id" = $5 and "receipt"."status" = $6) returning "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("mints exactly one receipt/retry event carrying the row id as a number", async () => {
		const { db } = retryDb(true);

		await caller(db).retry({ id: 9 });

		expect(door.events).toHaveLength(1);
		expect(door.events[0]?.name).toBe("receipt/retry");
		expect(door.events[0]?.data).toEqual({
			receiptId: 9,
			_trace: expect.any(Object),
		});
	});

	it("refuses a non-failed receipt with the exact message and mints nothing", async () => {
		const { db, queries } = retryDb(false);

		await expect(caller(db).retry({ id: 9 })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found or not in a failed state.",
		});
		expect(queries.map((q) => q.sql).slice(-1)).toEqual(["commit"]);
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
			      null,
			      "trace-retry",
			      "2026-09-10T02:00:00.000Z",
			      9,
			      "failed",
			    ],
			    "sql": "update "receipt" set "status" = $1, "error" = $2, "traceId" = $3, "updatedAt" = $4 where ("receipt"."id" = $5 and "receipt"."status" = $6) returning "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
		expect(door.events).toEqual([]);
	});
});

describe("receipt.delete", () => {
	function deleteDb({
		pathname,
		duplicateId,
	}: {
		pathname?: string;
		duplicateId?: number;
	}) {
		const respond: Respond = (query) => {
			if (query.sql.startsWith("select") && query.sql.includes("blobPathname"))
				return pathname === undefined ? [] : [[pathname]];
			if (query.sql.startsWith("select") && query.sql.includes("duplicateOfId"))
				return duplicateId === undefined ? [] : [[duplicateId]];
			if (query.sql.startsWith("delete")) return [];
			return new Error(`unexpected query: ${query.sql}`);
		};
		return recordingDb(respond);
	}

	it("removes the row then best-effort deletes the stored blob pathname", async () => {
		const { db, queries } = deleteDb({ pathname: "receipt-abc.jpg" });
		// Noted, not asserted, here: delete swallows anything the blob call throws.
		let rowGoneFirst = false;
		del.mockImplementationOnce(async () => {
			rowGoneFirst = queries.some((q) => q.sql.startsWith("delete"));
		});

		const result = await caller(db).delete({ id: 3 });

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
			      3,
			    ],
			    "sql": "select "blobPathname" from "receipt" where "receipt"."id" = $1 for update",
			  },
			  {
			    "method": "all",
			    "params": [
			      3,
			      1,
			    ],
			    "sql": "select "id" from "receipt" where "receipt"."duplicateOfId" = $1 limit $2",
			  },
			  {
			    "method": "execute",
			    "params": [
			      3,
			    ],
			    "sql": "delete from "receipt" where "receipt"."id" = $1",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
		expect(del).toHaveBeenCalledWith("receipt-abc.jpg");
		expect(rowGoneFirst).toBe(true);
		expect(result).toEqual({ success: true });
	});

	it("swallows a blob del failure — the row delete already committed", async () => {
		del.mockRejectedValueOnce(new Error("blob gone"));
		const { db, queries } = deleteDb({ pathname: "x.jpg" });

		await expect(caller(db).delete({ id: 1 })).resolves.toEqual({
			success: true,
		});
		expect(queries.some((q) => q.sql.startsWith("delete"))).toBe(true);
		expect(del).toHaveBeenCalledWith("x.jpg");
	});

	it("blocks with CONFLICT (row kept) when duplicate copies still reference it", async () => {
		const { db, queries } = deleteDb({ pathname: "x.jpg", duplicateId: 99 });

		await expect(caller(db).delete({ id: 5 })).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Delete the duplicate copies of this receipt first.",
		});
		expect(queries.some((q) => q.sql.startsWith("delete"))).toBe(false);
		expect(del).not.toHaveBeenCalled();
	});

	it("404s with the exact message when the receipt is gone", async () => {
		const { db, queries } = deleteDb({});

		await expect(caller(db).delete({ id: 404 })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Receipt not found.",
		});
		expect(queries).toHaveLength(3);
		expect(del).not.toHaveBeenCalled();
	});
});
