import { describe, expect, it } from "vitest";
import { formatMonthKey, fromDateInput, toDateInput } from "~/lib/utils";

describe("toDateInput", () => {
	it("formats a local date as YYYY-MM-DD", () => {
		expect(toDateInput(new Date(2026, 7, 22, 0, 0))).toBe("2026-08-22");
	});

	it("keeps the local day for a late-evening time (no UTC roll-forward)", () => {
		expect(toDateInput(new Date(2026, 7, 22, 23, 30))).toBe("2026-08-22");
	});
});

describe("fromDateInput", () => {
	it("parses a YYYY-MM-DD to local midnight (round-trips toDateInput)", () => {
		const parsed = fromDateInput("2026-08-14");
		expect(parsed).not.toBeNull();
		// Read the calendar parts, not the instant, so the assert holds in any tz.
		expect(toDateInput(parsed as Date)).toBe("2026-08-14");
		expect((parsed as Date).getHours()).toBe(0);
	});

	it("returns null for the wrong shape", () => {
		expect(fromDateInput("2026-08")).toBeNull();
		expect(fromDateInput("not-a-date")).toBeNull();
		expect(fromDateInput("")).toBeNull();
	});

	it("returns null for trailing junk instead of silently truncating", () => {
		expect(fromDateInput("2026-08-14-garbage")).toBeNull();
	});

	it("returns null for out-of-range values Date would roll over", () => {
		expect(fromDateInput("2026-13-01")).toBeNull();
		expect(fromDateInput("2026-02-30")).toBeNull();
	});

	it("returns null for a 2-digit year (Date maps 0-99 to 1900s)", () => {
		expect(fromDateInput("26-08-14")).toBeNull();
	});
});

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
