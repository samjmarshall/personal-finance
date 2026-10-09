import { describe, expect, it } from "vitest";
import {
	pgError,
	type Respond,
	recordingDb,
} from "~/server/db/recording-db.fake";
import { DrizzleMembersRepository } from "./members.repository";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleMembersRepository({ db: db as never }),
		queries,
	};
}

describe("DrizzleMembersRepository", () => {
	it("findNames selects the name of each given member", async () => {
		const { repository, queries } = harness(() => [
			["member-1", "Sam"],
			["member-2", "Alex"],
		]);

		await expect(
			repository.findNames(["member-1", "member-2"]),
		).resolves.toEqual([
			{ id: "member-1", name: "Sam" },
			{ id: "member-2", name: "Alex" },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "member-1",
			      "member-2",
			    ],
			    "sql": "select "id", "name" from "user" where "user"."id" in ($1, $2)",
			  },
			]
		`);
	});

	it("findNames lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("57P01"));

		await expect(repository.findNames(["member-1"])).rejects.toMatchObject({
			cause: { code: "57P01" },
		});
	});
});
