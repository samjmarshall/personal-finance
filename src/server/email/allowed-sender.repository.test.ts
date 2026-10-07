import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AllowedSender } from "~/domain/email";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleAllowedSenderRepository } from "./allowed-sender.repository";
import { allowedSenders } from "./allowed-sender.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleAllowedSenderRepository({ db: db as never }),
		queries,
	};
}

// Pins the $defaultFn createdAt drizzle adds to the insert.
const NOW = new Date("2026-10-07T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(allowedSenders));

const SENDER = {
	id: 1,
	email: "sam@example.com",
	userId: "member-1",
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
} satisfies AllowedSender;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("DrizzleAllowedSenderRepository", () => {
	it("list selects every address by email", async () => {
		const { repository, queries } = harness(() => [rowOf(COLUMNS, SENDER)]);

		await expect(repository.list()).resolves.toEqual([SENDER]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "email", "userId", "createdAt" from "allowed_sender" order by "allowed_sender"."email" asc",
			  },
			]
		`);
	});

	it("insert writes the address against the member and returns the stored row", async () => {
		const { repository, queries } = harness(() => [rowOf(COLUMNS, SENDER)]);

		await expect(
			repository.insert("member-1", "sam@example.com"),
		).resolves.toEqual(SENDER);
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

	it("insert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.insert("member-1", "sam@example.com"),
		).resolves.toBeUndefined();
	});

	it("insert lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23505"));

		await expect(
			repository.insert("member-1", "sam@example.com"),
		).rejects.toMatchObject({ cause: { code: "23505" } });
	});

	it("deleteOwn deletes only a row the member owns", async () => {
		const { repository, queries } = harness(() => [[1]]);

		await expect(repository.deleteOwn("member-1", 1)).resolves.toEqual({
			id: 1,
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

	// Every member sees every address id, so a client can send another member's.
	// Without the owner check this deletes it, and their receipts drop unseen.
	it("deleteOwn never deletes without the member as owner", async () => {
		const { repository, queries } = harness();

		await repository.deleteOwn("member-2", 1);

		expect(queries[0]?.sql).toContain(`"allowed_sender"."userId" = $2`);
		expect(queries[0]?.params).toEqual([1, "member-2"]);
	});

	it("deleteOwn gives undefined when no row matched", async () => {
		const { repository } = harness();

		await expect(repository.deleteOwn("member-1", 99)).resolves.toBeUndefined();
	});
});
