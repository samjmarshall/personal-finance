import { describe, expect, it } from "vitest";
import { formatMonthKey } from "~/lib/utils";

describe("formatMonthKey", () => {
	it("formats a YYYY-MM key as a short month and year", () => {
		expect(formatMonthKey("2026-08")).toBe("Aug 2026");
	});

	it("treats the month as 1-based", () => {
		expect(formatMonthKey("2026-01")).toBe("Jan 2026");
		expect(formatMonthKey("2026-12")).toBe("Dec 2026");
	});

	it("returns the key unchanged when either part is not a number", () => {
		expect(formatMonthKey("not-a-key")).toBe("not-a-key");
	});

	it("returns the key unchanged when the month is zero", () => {
		expect(formatMonthKey("2026-00")).toBe("2026-00");
	});
});
