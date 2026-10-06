import { describe, expect, it } from "vitest";
import {
	pgError,
	type Respond,
	recordingDb,
} from "~/server/db/recording-db.fake";
import { DrizzleSettingsRepository } from "./settings.repository";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleSettingsRepository({ db: db as never }),
		queries,
	};
}

describe("DrizzleSettingsRepository", () => {
	it("findValue selects the value under the key", async () => {
		const { repository, queries } = harness(() => [["2026-08-26"]]);

		await expect(repository.findValue("fortnightAnchor")).resolves.toBe(
			"2026-08-26",
		);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "fortnightAnchor",
			    ],
			    "sql": "select "value" from "app_setting" where "app_setting"."key" = $1",
			  },
			]
		`);
	});

	it("findValue gives undefined when no row has the key", async () => {
		const { repository } = harness();

		await expect(
			repository.findValue("fortnightAnchor"),
		).resolves.toBeUndefined();
	});

	it("upsert writes the value under the key and returns the stored row", async () => {
		const { repository, queries } = harness(() => [
			["fortnightAnchor", "2026-08-26"],
		]);

		await expect(
			repository.upsert("fortnightAnchor", "2026-08-26"),
		).resolves.toEqual({ key: "fortnightAnchor", value: "2026-08-26" });
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "fortnightAnchor",
			      "2026-08-26",
			      "2026-08-26",
			    ],
			    "sql": "insert into "app_setting" ("key", "value") values ($1, $2) on conflict ("key") do update set "value" = $3 returning "key", "value"",
			  },
			]
		`);
	});

	it("upsert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.upsert("fortnightAnchor", "2026-08-26"),
		).resolves.toBeUndefined();
	});

	it("upsert lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23502"));

		await expect(
			repository.upsert("fortnightAnchor", "2026-08-26"),
		).rejects.toMatchObject({ cause: { code: "23502" } });
	});
});
