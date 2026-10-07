import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Mirrors production: drizzle wraps the postgres.js PostgresError in a
// DrizzleQueryError with the driver error on `.cause`. Throwing this shape (not a
// bare {code}) is what pins the parser's `.cause` unwrap at the router layer —
// drop the hop and these CONFLICT tests go red instead of silently 500ing.
function pgError(code: string) {
	const driver = Object.assign(new Error("postgres"), { code });
	return Object.assign(new Error("Failed query"), { cause: driver });
}

// Fake db whose update().set().where().returning() throws `throws` or yields `rows`,
// recording the written values so the assertion can check the column touched.
function updateDb(outcome: { rows?: unknown[]; throws?: unknown }) {
	const written: { values?: unknown } = {};
	const db = {
		update: () => ({
			set: (values: unknown) => {
				written.values = values;
				return {
					where: () => ({
						returning: async () => {
							if (outcome.throws) throw outcome.throws;
							return outcome.rows ?? [];
						},
					}),
				};
			},
		}),
	};
	return { db, written };
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("receipt.confirmMatch", () => {
	it("links the receipt to the chosen transaction", async () => {
		const { db, written } = updateDb({ rows: [{ id: 3, transactionId: 77 }] });

		const row = await caller(db).confirmMatch({
			receiptId: 3,
			transactionId: 77,
		});

		expect(written.values).toEqual({ transactionId: 77 });
		expect(row).toMatchObject({ transactionId: 77 });
	});

	it("maps the unique-index violation (23505) to CONFLICT — the dup-photo catcher", async () => {
		const { db } = updateDb({ throws: pgError("23505") });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That transaction already has a receipt.",
		});
	});

	it("maps a deleted transaction (23503) to CONFLICT", async () => {
		const { db } = updateDb({ throws: pgError("23503") });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("passes a non-SQLSTATE failure through untouched", async () => {
		const boom = new Error("connection lost");
		const { db } = updateDb({ throws: boom });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toThrow("connection lost");
	});

	it("404s when the receipt is gone", async () => {
		const { db } = updateDb({ rows: [] });

		await expect(
			caller(db).confirmMatch({ receiptId: 3, transactionId: 77 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("receipt.setItemExpense", () => {
	it("attributes the item to an expense", async () => {
		const { db, written } = updateDb({ rows: [{ id: 5, expenseId: 4 }] });

		await caller(db).setItemExpense({ itemId: 5, expenseId: 4 });

		expect(written.values).toEqual({ expenseId: 4 });
	});

	it("clears the link when the member picks none", async () => {
		const { db, written } = updateDb({ rows: [{ id: 5, expenseId: null }] });

		await caller(db).setItemExpense({ itemId: 5, expenseId: null });

		expect(written.values).toEqual({ expenseId: null });
	});

	it("maps a vanished expense (23503) to CONFLICT", async () => {
		const { db } = updateDb({ throws: pgError("23503") });

		await expect(
			caller(db).setItemExpense({ itemId: 5, expenseId: 4 }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("404s when the item is gone", async () => {
		const { db } = updateDb({ rows: [] });

		await expect(
			caller(db).setItemExpense({ itemId: 5, expenseId: 4 }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("receipt.setItemCategory", () => {
	it("attributes the item to a category", async () => {
		const { db, written } = updateDb({
			rows: [{ id: 5, categoryId: 2 }],
		});

		await caller(db).setItemCategory({ itemId: 5, categoryId: 2 });

		expect(written.values).toEqual({ categoryId: 2 });
	});

	it("maps a vanished category (23503) to CONFLICT", async () => {
		const { db } = updateDb({ throws: pgError("23503") });

		await expect(
			caller(db).setItemCategory({ itemId: 5, categoryId: 2 }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});

// matchCandidates runs two selects: the receipt, then the windowed transactions
// leftJoined to receipts (the linked flag).
function matchDb(receipt: unknown | null, txRows: unknown[]) {
	let call = 0;
	return {
		select: () => {
			call += 1;
			if (call === 1)
				return {
					from: () => ({ where: async () => (receipt ? [receipt] : []) }),
				};
			return {
				from: () => ({ leftJoin: () => ({ where: async () => txRows }) }),
			};
		},
	};
}

describe("receipt.matchCandidates", () => {
	const receipt = { id: 3, total: 100, receiptDate: "2026-09-10" };

	it("ranks the in-window transactions and drops ones already claimed", async () => {
		const db = matchDb(receipt, [
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
		]);

		const result = await caller(db).matchCandidates({
			receiptId: 3,
			timeZone: TZ,
		});

		expect(result.map((c) => c.id)).toEqual([1, 3]);
	});

	it("skips the transaction scan entirely when there's nothing to match on", async () => {
		let selects = 0;
		const db = {
			select: () => {
				selects += 1;
				return {
					from: () => ({ where: async () => [{ ...receipt, total: null }] }),
				};
			},
		};

		await expect(
			caller(db).matchCandidates({ receiptId: 3, timeZone: TZ }),
		).resolves.toEqual([]);
		expect(selects).toBe(1);
	});

	it("404s when the receipt is gone", async () => {
		await expect(
			caller(matchDb(null, [])).matchCandidates({ receiptId: 3, timeZone: TZ }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
