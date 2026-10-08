import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { recordingDb, rowOf } from "~/server/db/recording-db.fake";
import { receipts } from "~/server/receipts/receipts.schema";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

const LIST_FIELDS = [
	...Object.keys(getTableColumns(receipts)),
	"userName",
	"transactionDescription",
];

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
	return recordingDb((query) =>
		query.sql.startsWith("select")
			? [rowOf(LIST_FIELDS, ROW)]
			: new Error(`unexpected query: ${query.sql}`),
	);
}

function caller(db: unknown) {
	return createCallerFactory(receiptRouter)({
		db,
		session: { user: { id: "user-1" } },
		headers: new Headers(),
	} as never);
}

describe("receipt.list filters", () => {
	it("applies no predicate at all when neither filter is set", async () => {
		const { db, queries } = listDb();

		await caller(db).list(undefined);

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "receipt"."id", "receipt"."status", "receipt"."channel", "receipt"."userId", "receipt"."blobUrl", "receipt"."blobPathname", "receipt"."contentType", "receipt"."contentHash", "receipt"."vendor", "receipt"."receiptDate", "receipt"."total", "receipt"."currency", "receipt"."rawJson", "receipt"."error", "receipt"."traceId", "receipt"."transactionId", "receipt"."duplicateOfId", "receipt"."createdAt", "receipt"."updatedAt", "user"."name", "transaction"."description" from "receipt" left join "user" on "receipt"."userId" = "user"."id" left join "transaction" on "receipt"."transactionId" = "transaction"."id" order by "receipt"."createdAt" desc, "receipt"."id" desc",
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
			  "select "receipt"."id", "receipt"."status", "receipt"."channel", "receipt"."userId", "receipt"."blobUrl", "receipt"."blobPathname", "receipt"."contentType", "receipt"."contentHash", "receipt"."vendor", "receipt"."receiptDate", "receipt"."total", "receipt"."currency", "receipt"."rawJson", "receipt"."error", "receipt"."traceId", "receipt"."transactionId", "receipt"."duplicateOfId", "receipt"."createdAt", "receipt"."updatedAt", "user"."name", "transaction"."description" from "receipt" left join "user" on "receipt"."userId" = "user"."id" left join "transaction" on "receipt"."transactionId" = "transaction"."id" where "receipt"."status" = $1 order by "receipt"."createdAt" desc, "receipt"."id" desc",
			]
		`);
		expect(queries[0]?.params).toEqual([ReceiptStatus.Processed]);
	});

	it("narrows to unmatched rows on its own, independent of status", async () => {
		const { db, queries } = listDb();

		await caller(db).list({ unmatchedOnly: true });

		expect(queries.map((q) => q.sql)).toMatchInlineSnapshot(`
			[
			  "select "receipt"."id", "receipt"."status", "receipt"."channel", "receipt"."userId", "receipt"."blobUrl", "receipt"."blobPathname", "receipt"."contentType", "receipt"."contentHash", "receipt"."vendor", "receipt"."receiptDate", "receipt"."total", "receipt"."currency", "receipt"."rawJson", "receipt"."error", "receipt"."traceId", "receipt"."transactionId", "receipt"."duplicateOfId", "receipt"."createdAt", "receipt"."updatedAt", "user"."name", "transaction"."description" from "receipt" left join "user" on "receipt"."userId" = "user"."id" left join "transaction" on "receipt"."transactionId" = "transaction"."id" where "receipt"."transactionId" is null order by "receipt"."createdAt" desc, "receipt"."id" desc",
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
			  "select "receipt"."id", "receipt"."status", "receipt"."channel", "receipt"."userId", "receipt"."blobUrl", "receipt"."blobPathname", "receipt"."contentType", "receipt"."contentHash", "receipt"."vendor", "receipt"."receiptDate", "receipt"."total", "receipt"."currency", "receipt"."rawJson", "receipt"."error", "receipt"."traceId", "receipt"."transactionId", "receipt"."duplicateOfId", "receipt"."createdAt", "receipt"."updatedAt", "user"."name", "transaction"."description" from "receipt" left join "user" on "receipt"."userId" = "user"."id" left join "transaction" on "receipt"."transactionId" = "transaction"."id" where ("receipt"."status" = $1 and "receipt"."transactionId" is null) order by "receipt"."createdAt" desc, "receipt"."id" desc",
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
