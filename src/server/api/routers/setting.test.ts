import { describe, expect, it } from "vitest";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { type Respond, recordingDb } from "~/server/db/recording-db.fake";
import { DrizzleSettingsRepository } from "~/server/settings/settings.repository";
import { SettingsService } from "~/server/settings/settings.service";
import { settingRouter } from "~/server/settings/settings.trpc.controller";

// Characterizes the router before it moves to src/server/settings/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ setting: settingRouter });

function harness(
	respond?: Respond,
	session: { user: { id: string } } | null = { user: { id: "member-1" } },
) {
	const { db, queries } = recordingDb(respond);
	const service = new SettingsService({
		repository: new DrizzleSettingsRepository({ db: db as never }),
	});
	const caller = createTestCaller(router, {
		services: { settings: service },
		session,
	});
	return { setting: caller.setting, queries };
}

describe("fortnightAnchor", () => {
	it("selects the value under the fortnight anchor key", async () => {
		const { setting, queries } = harness(() => [["2026-08-26"]]);

		await expect(setting.fortnightAnchor()).resolves.toBe("2026-08-26");
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

	it("gives null when no row has the key", async () => {
		const { setting } = harness();

		await expect(setting.fortnightAnchor()).resolves.toBeNull();
	});

	it("gives null when the stored value is not a real date", async () => {
		const { setting } = harness(() => [["2026-02-30"]]);

		await expect(setting.fortnightAnchor()).resolves.toBeNull();
	});
});

describe("setFortnightAnchor", () => {
	it("upserts the anchor under the shared key and returns the stored string", async () => {
		const { setting, queries } = harness(() => [
			["fortnightAnchor", "2026-08-26"],
		]);

		// A Date over the wire would re-read a day early for behind-UTC members —
		// the drift the query's string contract exists to avoid.
		await expect(
			setting.setFortnightAnchor({ anchor: "2026-08-26" }),
		).resolves.toBe("2026-08-26");
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

	it("fails as a 500 when the upsert returns no row", async () => {
		const { setting } = harness();

		await expect(
			setting.setFortnightAnchor({ anchor: "2026-08-26" }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to set fortnight anchor.",
		});
	});

	it("rejects a malformed date before any query", async () => {
		const { setting, queries } = harness();

		await expect(
			setting.setFortnightAnchor({ anchor: "2026-02-30" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(queries).toEqual([]);
	});
});

describe("signed out", () => {
	it.each([
		[
			"fortnightAnchor",
			(s: ReturnType<typeof harness>["setting"]) => s.fortnightAnchor(),
		],
		[
			"setFortnightAnchor",
			(s: ReturnType<typeof harness>["setting"]) =>
				s.setFortnightAnchor({ anchor: "2026-08-26" }),
		],
	])("rejects %s before any query", async (_name, call) => {
		const { setting, queries } = harness(undefined, null);

		await expect(call(setting)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(queries).toEqual([]);
	});
});
