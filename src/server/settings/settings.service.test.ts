import { describe, expect, it } from "vitest";
import {
	expectPlainError,
	failedQuery,
	throwing,
	unstaged,
} from "~/test/fakes";
import { FORTNIGHT_ANCHOR_KEY } from "./settings.constants";
import type { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

function serviceWith(staged: Partial<SettingsRepository>) {
	const repository: SettingsRepository = {
		findValue: unstaged,
		upsert: unstaged,
		...staged,
	};
	return new SettingsService({ repository });
}

describe("SettingsService", () => {
	it("fortnightAnchor reads the fortnight anchor key and returns a valid date", async () => {
		const keys: string[] = [];
		const service = serviceWith({
			findValue: async (key) => {
				keys.push(key);
				return "2026-08-26";
			},
		});

		await expect(service.fortnightAnchor()).resolves.toBe("2026-08-26");
		expect(keys).toEqual([FORTNIGHT_ANCHOR_KEY]);
	});

	it("fortnightAnchor gives null when no row has the key", async () => {
		const service = serviceWith({ findValue: async () => undefined });

		await expect(service.fortnightAnchor()).resolves.toBeNull();
	});

	it("fortnightAnchor gives null when the stored value is not a real date", async () => {
		const service = serviceWith({ findValue: async () => "2026-02-30" });

		await expect(service.fortnightAnchor()).resolves.toBeNull();
	});

	it("setFortnightAnchor upserts under the fortnight anchor key and returns the stored value", async () => {
		const upserts: unknown[][] = [];
		const service = serviceWith({
			upsert: async (key, value) => {
				upserts.push([key, value]);
				return { key, value };
			},
		});

		await expect(service.setFortnightAnchor("2026-08-26")).resolves.toBe(
			"2026-08-26",
		);
		expect(upserts).toEqual([[FORTNIGHT_ANCHOR_KEY, "2026-08-26"]]);
	});

	it("setFortnightAnchor throws a plain Error when the upsert returns no row", async () => {
		const service = serviceWith({ upsert: async () => undefined });

		const thrown = await service
			.setFortnightAnchor("2026-08-26")
			.catch((e: unknown) => e);

		expectPlainError(thrown, "Failed to set fortnight anchor.");
	});

	it("setFortnightAnchor lets a driver error through unchanged", async () => {
		const error = failedQuery("23502");
		const service = serviceWith({ upsert: throwing(error) });

		await expect(service.setFortnightAnchor("2026-08-26")).rejects.toBe(error);
	});
});
