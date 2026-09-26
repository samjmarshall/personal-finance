import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { allowedSenders } from "~/server/email/allowed-sender.schema";

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

const { createCallerFactory } = await import("~/server/api/trpc");
const { allowedSenderRouter } = await import("./allowed-sender");

const SESSION_USER_ID = "user-1";

function caller(db: unknown) {
	return createCallerFactory(allowedSenderRouter)({
		db,
		session: { user: { id: SESSION_USER_ID } },
		headers: new Headers(),
	} as never);
}

// Fake db whose insert().values().returning() records what was written and yields
// the given rows — or throws, to stand in for a unique-index violation.
// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
function insertDb(returning: any[], throws?: unknown) {
	const values = vi.fn(() => ({
		returning: async () => {
			if (throws) throw throws;
			return returning;
		},
	}));
	return { db: { insert: () => ({ values }) }, values };
}

// Captures the WHERE the delete is handed — that predicate is the ownership
// contract, so it is asserted rather than assumed.
// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
function deleteDb(returning: any[]) {
	let where: unknown;
	return {
		db: {
			delete: () => ({
				where: (w: unknown) => {
					where = w;
					return { returning: async () => returning };
				},
			}),
		},
		seen: () => where,
	};
}

// Mirrors production: drizzle wraps the postgres.js PostgresError in a
// DrizzleQueryError with the driver error on `.cause`. Throwing this shape (not a
// bare {code}) is what pins the parser's `.cause` unwrap at the router layer.
function pgError(code: string) {
	const driver = Object.assign(new Error("postgres"), { code });
	return Object.assign(new Error("Failed query"), { cause: driver });
}

describe("allowedSender.add", () => {
	// The owning Member is taken from the session, never the input — otherwise a
	// client could point someone else's address at their own inbox.
	it("persists the address against the session member", async () => {
		const { db, values } = insertDb([
			{ id: 1, email: "sam@example.com", userId: SESSION_USER_ID },
		]);

		await caller(db).add({ email: "  Sam@Example.COM  " });

		expect(values).toHaveBeenCalledWith({
			email: "sam@example.com",
			userId: SESSION_USER_ID,
		});
	});

	it("returns the stored row", async () => {
		const row = { id: 1, email: "sam@example.com", userId: SESSION_USER_ID };
		const { db } = insertDb([row]);

		await expect(caller(db).add({ email: "sam@example.com" })).resolves.toEqual(
			row,
		);
	});

	// The unique index is what keeps one address on exactly one Member. A member
	// re-adding an address must be told why, not handed a 500.
	it("maps a 23505 unique violation to CONFLICT", async () => {
		const { db } = insertDb([], pgError("23505"));

		await expect(
			caller(db).add({ email: "sam@example.com" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	// Only 23505 means "already on the allowlist"; anything else must stay a fault,
	// or a real outage would read to the member as a duplicate address.
	it("does not map an unrelated database error to CONFLICT", async () => {
		const { db } = insertDb([], pgError("23503"));

		await expect(
			caller(db).add({ email: "sam@example.com" }),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});

	it("raises when the insert returns nothing", async () => {
		const { db } = insertDb([]);

		await expect(
			caller(db).add({ email: "sam@example.com" }),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});
});

describe("allowedSender.remove", () => {
	it("deletes the entry", async () => {
		const h = deleteDb([{ id: 1 }]);

		await expect(caller(h.db).remove({ id: 1 })).resolves.toEqual({
			success: true,
		});
	});

	it("404s when no row matched", async () => {
		const h = deleteDb([]);

		await expect(caller(h.db).remove({ id: 99 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	// `list` is household-wide, so an id belonging to another member is one a client
	// can readily see and send. Without the userId arm this deletes it, and that
	// member's forwarded receipts then drop with nothing but a webhook log line.
	it("scopes the delete to the caller's own entries", async () => {
		const h = deleteDb([{ id: 1 }]);

		await caller(h.db).remove({ id: 1 });

		expect(h.seen()).toEqual(
			and(eq(allowedSenders.id, 1), eq(allowedSenders.userId, SESSION_USER_ID)),
		);
	});
});
