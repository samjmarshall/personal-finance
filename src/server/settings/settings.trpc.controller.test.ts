import { describe, expect, it } from "vitest";
import { createTestCaller } from "~/server/api/test-caller";
import { createTRPCRouter } from "~/server/api/trpc";
import { recorder } from "~/test/fakes";
import type { SettingsService } from "./settings.service";
import { settingRouter } from "./settings.trpc.controller";

const router = createTRPCRouter({ setting: settingRouter });

function callerWith(settings: Partial<SettingsService>, session?: null) {
	return createTestCaller(router, { services: { settings }, session });
}

describe("setting router", () => {
	it("fortnightAnchor returns the service's anchor", async () => {
		const { method, calls } = recorder("2026-08-26");

		await expect(
			callerWith({ fortnightAnchor: method }).setting.fortnightAnchor(),
		).resolves.toBe("2026-08-26");
		expect(calls).toEqual([[]]);
	});

	it("setFortnightAnchor hands the service the parsed anchor", async () => {
		const { method, calls } = recorder("2026-08-26");

		await expect(
			callerWith({ setFortnightAnchor: method }).setting.setFortnightAnchor({
				anchor: "2026-08-26",
			}),
		).resolves.toBe("2026-08-26");
		expect(calls).toEqual([["2026-08-26"]]);
	});

	it("rejects a malformed anchor before reaching the service", async () => {
		const { method, calls } = recorder("2026-02-30");

		await expect(
			callerWith({ setFortnightAnchor: method }).setting.setFortnightAnchor({
				anchor: "2026-02-30",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toEqual([]);
	});

	it("rejects a signed-out call before reaching the service", async () => {
		const { method, calls } = recorder("2026-08-26");

		await expect(
			callerWith({ fortnightAnchor: method }, null).setting.fortnightAnchor(),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(calls).toEqual([]);
	});
});
