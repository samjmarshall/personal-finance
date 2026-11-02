import { describe, expect, it } from "vitest";
import {
	importEarliestDay,
	importRangeError,
	importWindows,
} from "./import-range";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayAfter = (day: string) =>
	new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);

describe("importWindows", () => {
	it("gives one window for one day", () => {
		expect(importWindows("2026-03-01", "2026-03-01")).toEqual([
			{ from: "2026-03-01", to: "2026-03-01" },
		]);
	});

	it("fits exactly 90 days in one window", () => {
		expect(importWindows("2026-01-01", "2026-03-31")).toEqual([
			{ from: "2026-01-01", to: "2026-03-31" },
		]);
	});

	it("splits 91 days into two", () => {
		expect(importWindows("2026-01-01", "2026-04-01")).toEqual([
			{ from: "2026-01-01", to: "2026-03-31" },
			{ from: "2026-04-01", to: "2026-04-01" },
		]);
	});

	it("covers 7 years with no gap or overlap, ending on to", () => {
		const windows = importWindows("2019-10-28", "2026-10-28");

		expect(windows[0]?.from).toBe("2019-10-28");
		expect(windows.at(-1)?.to).toBe("2026-10-28");
		for (const [i, window] of windows.entries()) {
			expect(window.from <= window.to).toBe(true);
			const next = windows[i + 1];
			if (next) expect(next.from).toBe(dayAfter(window.to));
		}
		expect(windows).toHaveLength(29);
	});
});

describe("importEarliestDay", () => {
	it("is the same day seven years back", () => {
		expect(importEarliestDay("2026-10-28")).toBe("2019-10-28");
	});

	// A bad day like "2021-02-29" makes the date picker drop its min.
	it("gives a real day when today is Feb 29", () => {
		expect(importEarliestDay("2028-02-29")).toBe("2021-02-28");
	});
});

describe("importRangeError", () => {
	const today = "2026-10-28";

	it("passes a range inside the limits", () => {
		expect(importRangeError("2019-10-28", today, today)).toBeNull();
	});

	it.each([
		["", today, "Pick a From and a To day."],
		[
			"2026-03-01",
			"2026-02-01",
			"The From day must be on or before the To day.",
		],
		["2026-01-01", "2026-10-29", "The To day can't be after today."],
		["2019-10-27", "2020-01-01", "An import can reach back 7 years at most."],
	])("refuses %s to %s", (from, to, message) => {
		expect(importRangeError(from, to, today)).toBe(message);
	});
});
