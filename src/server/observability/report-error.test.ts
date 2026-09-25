import { describe, expect, it, vi } from "vitest";

import type { Logger } from "./logger";

vi.mock("./posthog", () => ({ captureException: vi.fn() }));

const { captureException } = await import("./posthog");
const { reportError } = await import("./report-error");

describe("reportError", () => {
	// An issue with no matching log line can't be traced back; send both, same attrs.
	it("captures and logs the error with the same attrs", () => {
		const logs: unknown[] = [];
		const logger = {
			error: (msg: string, attrs: unknown) => logs.push({ msg, attrs }),
		} as unknown as Logger;
		const error = new Error("boom");

		reportError(logger, "thing failed", error, { "trpc.path": "a.b" });

		expect(captureException).toHaveBeenCalledWith(error, {
			"trpc.path": "a.b",
		});
		expect(logs).toEqual([
			{ msg: "thing failed", attrs: { error, "trpc.path": "a.b" } },
		]);
	});
});
