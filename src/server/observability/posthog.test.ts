import { afterEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();

vi.mock("~/env", () => ({
	env: { POSTHOG_KEY: "phc_test", POSTHOG_HOST: "https://us.i.posthog.com" },
}));
vi.mock("posthog-node", () => ({
	PostHog: class {
		captureException = capture;
	},
}));

const { captureException } = await import("./posthog");

afterEach(() => {
	capture.mockClear();
	vi.unstubAllEnvs();
});

describe("captureException", () => {
	it("tags the Vercel environment so alerts can filter to production", () => {
		vi.stubEnv("VERCEL_ENV", "production");

		captureException(new Error("boom"));

		expect(capture).toHaveBeenCalledWith(
			expect.any(Error),
			"server",
			expect.objectContaining({ "deployment.environment.name": "production" }),
		);
	});
});
