import { describe, expect, it } from "vitest";
import {
	fortnightWindow,
	monthWindow,
	type PeriodWindow,
	shiftWindow,
} from "~/lib/period";
import { toDateInput } from "~/lib/utils";

// Render a half-open window as readable local [from, to) so a failed grid case
// reads as dates, not epoch millis.
const fmt = (w: PeriodWindow) =>
	`[${toDateInput(w.from)}, ${toDateInput(w.to)})`;

describe("monthWindow", () => {
	it.each([
		["mid-month", new Date(2026, 7, 22), "[2026-08-01, 2026-09-01)"],
		["first of the month", new Date(2026, 7, 1), "[2026-08-01, 2026-09-01)"],
		[
			"december rolls the year",
			new Date(2026, 11, 15),
			"[2026-12-01, 2027-01-01)",
		],
		["january", new Date(2026, 0, 10), "[2026-01-01, 2026-02-01)"],
	])("%s", (_label, ref, expected) => {
		expect(fmt(monthWindow(ref))).toBe(expected);
	});
});

describe("fortnightWindow", () => {
	const anchor = new Date(2026, 7, 14); // a payday: 2026-08-14

	it.each([
		[
			"ref on the anchor day",
			new Date(2026, 7, 14),
			"[2026-08-14, 2026-08-28)",
		],
		["ref mid-window", new Date(2026, 7, 20), "[2026-08-14, 2026-08-28)"],
		[
			"ref on the last day of the window",
			new Date(2026, 7, 27),
			"[2026-08-14, 2026-08-28)",
		],
		[
			"ref before the anchor date",
			new Date(2026, 7, 10),
			"[2026-07-31, 2026-08-14)",
		],
		[
			"ref many fortnights later",
			new Date(2026, 10, 6),
			"[2026-11-06, 2026-11-20)",
		],
	])("%s", (_label, ref, expected) => {
		expect(fmt(fortnightWindow(anchor, ref))).toBe(expected);
	});

	it("seeds the grid from the anchor's calendar date, ignoring its time", () => {
		const lateAnchor = new Date(2026, 7, 14, 23, 30);
		expect(fmt(fortnightWindow(lateAnchor, new Date(2026, 7, 20)))).toBe(
			"[2026-08-14, 2026-08-28)",
		);
	});
});

describe("shiftWindow", () => {
	it("steps a month window to the next and previous month", () => {
		const august = monthWindow(new Date(2026, 7, 15));
		expect(fmt(shiftWindow(august, "month", 1))).toBe(
			"[2026-09-01, 2026-10-01)",
		);
		expect(fmt(shiftWindow(august, "month", -1))).toBe(
			"[2026-07-01, 2026-08-01)",
		);
	});

	it("steps a month window across the year boundary", () => {
		const december = monthWindow(new Date(2026, 11, 15));
		expect(fmt(shiftWindow(december, "month", 1))).toBe(
			"[2027-01-01, 2027-02-01)",
		);
	});

	it("steps a fortnight window by 14 days, preserving grid alignment", () => {
		const first = fortnightWindow(new Date(2026, 7, 14), new Date(2026, 7, 20));
		expect(fmt(shiftWindow(first, "fortnight", 1))).toBe(
			"[2026-08-28, 2026-09-11)",
		);
		expect(fmt(shiftWindow(first, "fortnight", -1))).toBe(
			"[2026-07-31, 2026-08-14)",
		);
	});
});
