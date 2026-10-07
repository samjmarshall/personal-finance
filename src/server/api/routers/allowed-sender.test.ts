import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllowedSender } from "~/domain/email";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { allowedSenders } from "~/server/email/allowed-sender.schema";
import { allowedSenderRouter } from "./allowed-sender";

// Characterizes the router before it moves to src/server/email/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ allowedSender: allowedSenderRouter });

function harness(
	respond?: Respond,
	session: { user: { id: string } } | null = { user: { id: "member-1" } },
) {
	const { db, queries } = recordingDb(respond);
	const caller = createCallerFactory(router)({
		db,
		session,
		services: {},
		headers: new Headers(),
	} as never);
	return { allowedSender: caller.allowedSender, queries };
}

// Pins the $defaultFn createdAt drizzle adds to the insert.
const NOW = new Date("2026-10-07T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(allowedSenders));
const LIST_COLUMNS = [...COLUMNS, "userName"];

const SAM_SENDER = {
	id: 1,
	email: "sam@example.com",
	userId: "member-1",
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
} satisfies AllowedSender;

const ALEX_SENDER = {
	id: 2,
	email: "shop@example.com",
	userId: "member-2",
	createdAt: new Date("2026-09-02T01:00:00.000Z"),
} satisfies AllowedSender;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("allowedSender.list", () => {
	it("lists every Member's addresses with owner names, flagging the caller's own", async () => {
		const { allowedSender, queries } = harness(() => [
			rowOf(LIST_COLUMNS, { ...SAM_SENDER, userName: "Sam" }),
			rowOf(LIST_COLUMNS, { ...ALEX_SENDER, userName: "Alex" }),
		]);

		await expect(allowedSender.list()).resolves.toEqual([
			{ ...SAM_SENDER, userName: "Sam", isOwn: true },
			{ ...ALEX_SENDER, userName: "Alex", isOwn: false },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "allowed_sender"."id", "allowed_sender"."email", "allowed_sender"."userId", "allowed_sender"."createdAt", "user"."name" from "allowed_sender" left join "user" on "allowed_sender"."userId" = "user"."id" order by "allowed_sender"."email" asc",
			  },
			]
		`);
	});

	it("gives a null userName when the owner has no user row", async () => {
		const { allowedSender } = harness(() => [
			rowOf(LIST_COLUMNS, { ...ALEX_SENDER, userName: null }),
		]);

		await expect(allowedSender.list()).resolves.toEqual([
			{ ...ALEX_SENDER, userName: null, isOwn: false },
		]);
	});

	it("gives an empty list in one query when no addresses are allowed", async () => {
		const { allowedSender, queries } = harness();

		await expect(allowedSender.list()).resolves.toEqual([]);
		expect(queries).toHaveLength(1);
	});
});

describe("allowedSender.add", () => {
	// The owning Member is taken from the session, never the input — otherwise a
	// client could point someone else's address at their own inbox.
	it("persists the normalised address against the session member and returns the stored row", async () => {
		const { allowedSender, queries } = harness(() => [
			rowOf(COLUMNS, SAM_SENDER),
		]);

		await expect(
			allowedSender.add({ email: "  Sam@Example.COM  " }),
		).resolves.toEqual(SAM_SENDER);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "sam@example.com",
			      "member-1",
			      "2026-10-07T00:00:00.000Z",
			    ],
			    "sql": "insert into "allowed_sender" ("id", "email", "userId", "createdAt") values (default, $1, $2, $3) returning "id", "email", "userId", "createdAt"",
			  },
			]
		`);
	});

	// The unique index is what keeps one address on exactly one Member. A member
	// re-adding an address must be told why, not handed a 500.
	it("maps a 23505 unique violation to CONFLICT", async () => {
		const { allowedSender } = harness(() => pgError("23505"));

		await expect(
			allowedSender.add({ email: "sam@example.com" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That address is already on the allowlist.",
		});
	});

	// Only 23505 means "already on the allowlist"; anything else must stay a fault,
	// or a real outage would read to the member as a duplicate address.
	it("does not map an unrelated database error to CONFLICT", async () => {
		const { allowedSender } = harness(() => pgError("23503"));

		await expect(
			allowedSender.add({ email: "sam@example.com" }),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});

	it("fails as a 500 when the insert returns no row", async () => {
		const { allowedSender } = harness();

		await expect(
			allowedSender.add({ email: "sam@example.com" }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to add allowed sender.",
		});
	});

	it("rejects a malformed address before any query", async () => {
		const { allowedSender, queries } = harness();

		await expect(
			allowedSender.add({ email: "not-an-email" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(queries).toEqual([]);
	});
});

describe("allowedSender.remove", () => {
	// `list` is household-wide, so an id belonging to another member is one a client
	// can readily see and send. Without the userId arm this deletes it, and that
	// member's forwarded receipts then drop with nothing but a webhook log line.
	it("scopes the delete to the caller's own entries", async () => {
		const { allowedSender, queries } = harness(() => [[1]]);

		await expect(allowedSender.remove({ id: 1 })).resolves.toEqual({
			success: true,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			      "member-1",
			    ],
			    "sql": "delete from "allowed_sender" where ("allowed_sender"."id" = $1 and "allowed_sender"."userId" = $2) returning "id"",
			  },
			]
		`);
	});

	it("404s when no row matched", async () => {
		const { allowedSender } = harness();

		await expect(allowedSender.remove({ id: 99 })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "That address is not on your allowlist.",
		});
	});
});

describe("signed out", () => {
	type Caller = ReturnType<typeof harness>["allowedSender"];

	it.each([
		["list", (a: Caller) => a.list()],
		["add", (a: Caller) => a.add({ email: "sam@example.com" })],
		["remove", (a: Caller) => a.remove({ id: 1 })],
	])("rejects %s before any query", async (_name, call) => {
		const { allowedSender, queries } = harness(undefined, null);

		await expect(call(allowedSender)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(queries).toEqual([]);
	});
});
