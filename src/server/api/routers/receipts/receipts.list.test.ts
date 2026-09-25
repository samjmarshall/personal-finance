import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ReceiptStatus } from "~/lib/constants";
import { receipts } from "~/server/receipts/receipts.schema";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox: vi.fn() }));
vi.mock("@vercel/blob", () => ({ del: vi.fn() }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { receiptRouter } = await import("./receipts");

// Captures the WHERE the query builder is handed — that predicate *is* the filter
// contract, and the bug this guards was an arm silently added to it.
function listDb() {
	let where: unknown;
	const chain = {
		from: () => chain,
		leftJoin: () => chain,
		where: (w: unknown) => {
			where = w;
			return { orderBy: async () => [] };
		},
	};
	return { db: { select: () => chain }, seen: () => where };
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
		const h = listDb();
		await caller(h.db).list(undefined);
		expect(h.seen()).toBeUndefined();
	});

	// The regression: status used to silently AND `transactionId is null`, so a
	// matched receipt was unreachable through every value of the status dropdown.
	it("narrows by status only — matched receipts stay reachable", async () => {
		const h = listDb();
		await caller(h.db).list({ status: ReceiptStatus.Processed });
		expect(h.seen()).toEqual(and(eq(receipts.status, ReceiptStatus.Processed)));
	});

	it("narrows to unmatched rows on its own, independent of status", async () => {
		const h = listDb();
		await caller(h.db).list({ unmatchedOnly: true });
		expect(h.seen()).toEqual(and(isNull(receipts.transactionId)));
	});

	it("combines both when both are set — the to-do queue", async () => {
		const h = listDb();
		await caller(h.db).list({
			status: ReceiptStatus.Processed,
			unmatchedOnly: true,
		});
		expect(h.seen()).toEqual(
			and(
				eq(receipts.status, ReceiptStatus.Processed),
				isNull(receipts.transactionId),
			),
		);
	});
});
