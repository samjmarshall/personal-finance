import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Receipt, ReceiptItem } from "~/domain/receipts";
import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import type { OutboxWriteDoor } from "~/server/outbox/outbox.service";
import { unstaged } from "~/test/fakes";
import { DrizzleReceiptsRepository } from "./receipts.repository";
import { receiptItems, receipts } from "./receipts.schema";

// Stand-in write door: runs the writes in the test db's transaction and keeps the
// events, so the SQL lands in the snapshot. outbox.service.test.ts covers the real one.
function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	const events: OutboxEventDescriptor[] = [];
	const outbox: OutboxWriteDoor = {
		commit: (writes, toEvents) =>
			db.transaction(async (tx) => {
				const result = await writes(tx as never);
				events.push(...toEvents(result));
				return result;
			}),
		publish: unstaged,
	};
	return {
		repository: new DrizzleReceiptsRepository({ db: db as never, outbox }),
		queries,
		events,
	};
}

// Fixed clock so auto-set timestamps stay stable in snapshots.
const NOW = new Date("2026-09-29T00:00:00.000Z");

const RECEIPT_COLUMNS = Object.keys(getTableColumns(receipts));
const ITEM_COLUMNS = Object.keys(getTableColumns(receiptItems));

const RECEIPT = {
	id: 42,
	status: ReceiptStatus.Pending,
	channel: ReceiptChannel.Upload,
	userId: "member-1",
	blobUrl: "https://blob.vercel-storage.com/receipt-abc.jpg",
	blobPathname: "receipt-abc.jpg",
	contentType: "image/jpeg",
	contentHash: null,
	vendor: null,
	receiptDate: null,
	total: null,
	currency: null,
	rawJson: null,
	error: null,
	traceId: "trace-abc",
	transactionId: null,
	duplicateOfId: null,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
} satisfies Receipt;

const ITEM = {
	id: 5,
	receiptId: 42,
	name: "Milk",
	price: 3.5,
	quantity: 1,
	expenseId: null,
	categoryId: null,
	createdAt: new Date("2026-09-10T01:00:00.000Z"),
	updatedAt: null,
} satisfies ReceiptItem;

const PENDING = {
	userId: RECEIPT.userId,
	channel: RECEIPT.channel,
	blobUrl: RECEIPT.blobUrl,
	blobPathname: RECEIPT.blobPathname,
	contentType: RECEIPT.contentType,
	traceId: RECEIPT.traceId,
};

const receiptRow = (fixture: Partial<Receipt> = {}) =>
	rowOf(RECEIPT_COLUMNS, { ...RECEIPT, ...fixture });

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("insertPending", () => {
	it("inserts pending rows in a transaction and returns them", async () => {
		const { repository, queries } = harness(() => [receiptRow()]);

		await expect(
			repository.insertPending([PENDING], "receipt/uploaded"),
		).resolves.toEqual([RECEIPT]);
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
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
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
	});

	it("names one event per row, carrying its id", async () => {
		const { repository, events } = harness(() => [
			receiptRow({ id: 7 }),
			receiptRow({ id: 8 }),
		]);

		await repository.insertPending(
			[PENDING, PENDING],
			"receipt/email.received",
		);

		expect(events.map(({ name, data }) => [name, data])).toEqual([
			["receipt/email.received", { receiptId: 7, _trace: expect.any(Object) }],
			["receipt/email.received", { receiptId: 8, _trace: expect.any(Object) }],
		]);
	});
});

describe("findAll", () => {
	it("selects every row, newest first, with no filter", async () => {
		const { repository, queries } = harness(() => [receiptRow()]);

		await expect(repository.findAll({})).resolves.toEqual([RECEIPT]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  },
			]
		`);
	});

	it("narrows by status and to unmatched rows together", async () => {
		const { repository, queries } = harness(() => []);

		await repository.findAll({
			status: ReceiptStatus.Failed,
			unmatchedOnly: true,
		});

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "failed",
			    ],
			    "sql": "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where ("receipt"."status" = $1 and "receipt"."transactionId" is null) order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  },
			]
		`);
	});

	it("narrows by status alone", async () => {
		const { repository, queries } = harness(() => []);

		await repository.findAll({ status: ReceiptStatus.Failed });

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "failed",
			    ],
			    "sql": "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."status" = $1 order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  },
			]
		`);
	});

	it("narrows to unmatched rows alone", async () => {
		const { repository, queries } = harness(() => []);

		await repository.findAll({ unmatchedOnly: true });

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."transactionId" is null order by "receipt"."createdAt" desc, "receipt"."id" desc",
			  },
			]
		`);
	});
});

describe("findById", () => {
	it("selects the row by id", async () => {
		const { repository, queries } = harness(() => [receiptRow()]);

		await expect(repository.findById(42)).resolves.toEqual(RECEIPT);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      42,
			    ],
			    "sql": "select "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt" from "receipt" where "receipt"."id" = $1",
			  },
			]
		`);
	});

	it("returns undefined for a missing id", async () => {
		const { repository } = harness(() => []);

		await expect(repository.findById(42)).resolves.toBeUndefined();
	});
});

describe("findItems", () => {
	it("selects the receipt's items in id order", async () => {
		const { repository, queries } = harness(() => [rowOf(ITEM_COLUMNS, ITEM)]);

		await expect(repository.findItems(42)).resolves.toEqual([ITEM]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      42,
			    ],
			    "sql": "select "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt" from "receipt_item" where "receipt_item"."receiptId" = $1 order by "receipt_item"."id" asc",
			  },
			]
		`);
	});
});

describe("requeueFailed", () => {
	it("sets a failed row back to pending under the new trace and names receipt/retry", async () => {
		const { repository, queries, events } = harness(() => [receiptRow()]);

		await expect(repository.requeueFailed(42, "trace-new")).resolves.toEqual(
			RECEIPT,
		);
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
			      "trace-new",
			      "2026-09-29T00:00:00.000Z",
			      42,
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
		expect(events.map(({ name, data }) => [name, data])).toEqual([
			["receipt/retry", { receiptId: 42, _trace: expect.any(Object) }],
		]);
	});

	it("names no event when no failed row matches", async () => {
		const { repository, events } = harness(() => []);

		await expect(
			repository.requeueFailed(42, "trace-new"),
		).resolves.toBeUndefined();
		expect(events).toEqual([]);
	});
});

describe("findBlobPathname", () => {
	it("selects the pathname by id", async () => {
		const { repository, queries } = harness(() => [["receipt-abc.jpg"]]);

		await expect(repository.findBlobPathname(42)).resolves.toBe(
			"receipt-abc.jpg",
		);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      42,
			    ],
			    "sql": "select "blobPathname" from "receipt" where "receipt"."id" = $1",
			  },
			]
		`);
	});

	it("returns undefined for a missing id", async () => {
		const { repository } = harness(() => []);

		await expect(repository.findBlobPathname(42)).resolves.toBeUndefined();
	});
});

describe("deleteUnlessDuplicated", () => {
	const respond =
		({ found = true, copies = false } = {}): Respond =>
		({ sql }) => {
			if (sql.includes('"duplicateOfId" =')) return copies ? [[9]] : [];
			if (sql.startsWith("select")) return found ? [["receipt-abc.jpg"]] : [];
			return [];
		};

	it("locks the row, probes for copies, then deletes it in one transaction", async () => {
		const { repository, queries } = harness(respond());

		await expect(repository.deleteUnlessDuplicated(42)).resolves.toEqual({
			blobPathname: "receipt-abc.jpg",
		});
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
			      42,
			    ],
			    "sql": "select "blobPathname" from "receipt" where "receipt"."id" = $1 for update",
			  },
			  {
			    "method": "all",
			    "params": [
			      42,
			      1,
			    ],
			    "sql": "select "id" from "receipt" where "receipt"."duplicateOfId" = $1 limit $2",
			  },
			  {
			    "method": "execute",
			    "params": [
			      42,
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
	});

	it("deletes nothing when the row is missing", async () => {
		const { repository, queries } = harness(respond({ found: false }));

		await expect(repository.deleteUnlessDuplicated(42)).resolves.toBe(
			"missing",
		);
		expect(queries.map(({ sql }) => sql.split(" ")[0])).toEqual([
			"begin",
			"select",
			"commit",
		]);
	});

	it("deletes nothing when a copy points at the row", async () => {
		const { repository, queries } = harness(respond({ copies: true }));

		await expect(repository.deleteUnlessDuplicated(42)).resolves.toBe(
			"has-duplicates",
		);
		expect(queries.map(({ sql }) => sql.split(" ")[0])).toEqual([
			"begin",
			"select",
			"select",
			"commit",
		]);
	});
});

describe("findMatchInput", () => {
	it("selects the total and receipt date by id", async () => {
		const { repository, queries } = harness(() => [[42.5, "2026-09-10"]]);

		await expect(repository.findMatchInput(42)).resolves.toEqual({
			total: 42.5,
			receiptDate: "2026-09-10",
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      42,
			    ],
			    "sql": "select "total", "receiptDate" from "receipt" where "receipt"."id" = $1",
			  },
			]
		`);
	});
});

describe("findMatchedTransactionIds", () => {
	it("selects which of the transactions a receipt already claims", async () => {
		const { repository, queries } = harness(() => [[3]]);

		await expect(repository.findMatchedTransactionIds([3, 4])).resolves.toEqual(
			[3],
		);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			      4,
			    ],
			    "sql": "select "transactionId" from "receipt" where "receipt"."transactionId" in ($1, $2)",
			  },
			]
		`);
	});

	it("skips the query for no ids", async () => {
		const { repository, queries } = harness();

		await expect(repository.findMatchedTransactionIds([])).resolves.toEqual([]);
		expect(queries).toEqual([]);
	});
});

describe("setTransaction", () => {
	it("links the receipt to the transaction and returns the row", async () => {
		const { repository, queries } = harness(() => [
			receiptRow({ transactionId: 3 }),
		]);

		await expect(repository.setTransaction(42, 3)).resolves.toEqual({
			...RECEIPT,
			transactionId: 3,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			      "2026-09-29T00:00:00.000Z",
			      42,
			    ],
			    "sql": "update "receipt" set "transactionId" = $1, "updatedAt" = $2 where "receipt"."id" = $3 returning "id", "status", "channel", "userId", "blobUrl", "blobPathname", "contentType", "contentHash", "vendor", "receiptDate", "total", "currency", "rawJson", "error", "traceId", "transactionId", "duplicateOfId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("lets a driver error propagate", async () => {
		const { repository } = harness(() => pgError("23505"));

		await expect(repository.setTransaction(42, 3)).rejects.toMatchObject({
			cause: { code: "23505" },
		});
	});
});

describe("setItemExpense", () => {
	it("links the item to the Expense and returns the row", async () => {
		const { repository, queries } = harness(() => [
			rowOf(ITEM_COLUMNS, { ...ITEM, expenseId: 7 }),
		]);

		await expect(repository.setItemExpense(5, 7)).resolves.toEqual({
			...ITEM,
			expenseId: 7,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      "2026-09-29T00:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "expenseId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("unlinks the Expense with null", async () => {
		const { repository, queries } = harness(() => [rowOf(ITEM_COLUMNS, ITEM)]);

		await expect(repository.setItemExpense(5, null)).resolves.toEqual(ITEM);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      null,
			      "2026-09-29T00:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "expenseId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});
});

describe("setItemCategory", () => {
	it("links the item to the Category and returns the row", async () => {
		const { repository, queries } = harness(() => [
			rowOf(ITEM_COLUMNS, { ...ITEM, categoryId: 3 }),
		]);

		await expect(repository.setItemCategory(5, 3)).resolves.toEqual({
			...ITEM,
			categoryId: 3,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			      "2026-09-29T00:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "categoryId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("unlinks the Category with null", async () => {
		const { repository, queries } = harness(() => [rowOf(ITEM_COLUMNS, ITEM)]);

		await expect(repository.setItemCategory(5, null)).resolves.toEqual(ITEM);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      null,
			      "2026-09-29T00:00:00.000Z",
			      5,
			    ],
			    "sql": "update "receipt_item" set "categoryId" = $1, "updatedAt" = $2 where "receipt_item"."id" = $3 returning "id", "receiptId", "name", "price", "quantity", "expenseId", "categoryId", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("returns undefined for a missing item", async () => {
		const { repository } = harness(() => []);

		await expect(repository.setItemCategory(5, null)).resolves.toBeUndefined();
	});
});
