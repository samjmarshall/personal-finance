import { describe, expect, it, vi } from "vitest";

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

// biome-ignore lint/suspicious/noExplicitAny: hand-rolled db stands in for drizzle.
function deleteDb(returning: any[]) {
	return {
		delete: () => ({ where: () => ({ returning: async () => returning }) }),
	};
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
		const { db } = insertDb([], { code: "23505" });

		await expect(
			caller(db).add({ email: "sam@example.com" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	// Only 23505 means "already on the allowlist"; anything else must stay a fault,
	// or a real outage would read to the member as a duplicate address.
	it("does not map an unrelated database error to CONFLICT", async () => {
		const { db } = insertDb([], { code: "23503" });

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
		await expect(
			caller(deleteDb([{ id: 1 }])).remove({ id: 1 }),
		).resolves.toEqual({ success: true });
	});

	it("404s when no row matched", async () => {
		await expect(caller(deleteDb([])).remove({ id: 99 })).rejects.toMatchObject(
			{
				code: "NOT_FOUND",
			},
		);
	});
});
