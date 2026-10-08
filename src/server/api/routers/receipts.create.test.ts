import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReceiptChannel, ReceiptStatus } from "~/lib/constants";
import { recordingDb, rowOf } from "~/server/db/recording-db.fake";
import type { OutboxEventDescriptor } from "~/server/inngest/events";
import type { OutboxEvents, OutboxWrites } from "~/server/outbox";
import { receipts } from "~/server/receipts/receipts.schema";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure producer unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

// Stand-in write door: runs the writes in the test db's transaction and records the
// derived events, so the insert SQL lands in the snapshot. The real door is
// exercised in outbox/outbox.service.test.ts.
const door = vi.hoisted(() => ({
	db: undefined as
		| {
				transaction: (run: (tx: never) => Promise<unknown>) => Promise<unknown>;
		  }
		| undefined,
	events: [] as OutboxEventDescriptor[],
}));
vi.mock("~/server/outbox", () => ({
	commitWithOutbox: async <T>(
		writes: OutboxWrites<T>,
		events: OutboxEvents<T>,
	): Promise<T> => {
		if (!door.db) throw new Error("door has no db");
		return (await door.db.transaction(async (tx) => {
			const result = await writes(tx);
			door.events.push(...events(result));
			return result;
		})) as T;
	},
}));

// currentTraceId reads the ambient OTel span; stub it so the test asserts the id is
// threaded onto the insert, not whether a provider happens to be registered.
const { currentTraceId } = vi.hoisted(() => ({ currentTraceId: vi.fn() }));
vi.mock("~/server/observability/tracing/current-trace-id", () => ({
	currentTraceId,
}));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

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

function caller(db: ReturnType<typeof createDb>["db"]) {
	door.db = db as never;
	return createCallerFactory(receiptRouter)({
		db,
		session: { user: { id: "member-1" } },
		headers: new Headers(),
	} as never);
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
