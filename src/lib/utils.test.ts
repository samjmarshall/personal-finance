import { describe, expect, it } from "vitest";
import {
	formatDate,
	formatMonthKey,
	fromDateInput,
	isPast,
	startOfDayInZone,
	toDateInput,
} from "~/lib/utils";

describe("formatDate", () => {
	// A `date` column (receiptDate) arrives as a bare calendar day. `new Date()` reads
	// that as UTC midnight, which renders the day *before* anywhere behind UTC — the
	// exact drift toDateInput/fromDateInput exist to avoid.
	it("renders a YYYY-MM-DD as that calendar day, not a UTC instant", () => {
		expect(formatDate("2026-08-04")).toBe(formatDate(new Date(2026, 7, 4)));
	});

	it("still parses a full timestamp as the instant it is", () => {
		const instant = "2026-08-04T13:45:00Z";
		expect(formatDate(instant)).toBe(formatDate(new Date(instant)));
	});

	it("renders an em dash for nothing", () => {
		expect(formatDate(null)).toBe("—");
		expect(formatDate(undefined)).toBe("—");
	});
});

describe("startOfDayInZone", () => {
	// 20:00 UTC is already the next day in Brisbane (UTC+10) — the skew that made the
	// server (UTC) disagree with the browser about which day a transaction fell on.
	const lateUtc = new Date("2026-09-14T20:00:00Z");

	it("resolves the calendar day in the given zone", () => {
		expect(toDateInput(startOfDayInZone(lateUtc, "UTC"))).toBe("2026-09-14");
		expect(toDateInput(startOfDayInZone(lateUtc, "Australia/Brisbane"))).toBe(
			"2026-09-15",
		);
	});

	it("returns local midnight so it subtracts cleanly against fromDateInput", () => {
		expect(startOfDayInZone(lateUtc, "UTC").getHours()).toBe(0);
	});

	it("falls back to the runtime zone rather than throwing on an unknown zone", () => {
		expect(toDateInput(startOfDayInZone(lateUtc, "Not/AZone"))).toBe(
			toDateInput(lateUtc),
		);
	});
});

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

describe("isPast", () => {
	// [label, date, now, expected] — compared by local calendar day, so a
	// one-time due today counts as upcoming, not past.
	const cases: [string, Date, Date, boolean][] = [
		["today is not past", new Date(2026, 7, 22), new Date(2026, 7, 22), false],
		[
			"a later time today is still not past",
			new Date(2026, 7, 22, 23, 30),
			new Date(2026, 7, 22, 1, 0),
			false,
		],
		["yesterday is past", new Date(2026, 7, 21), new Date(2026, 7, 22), true],
		[
			"tomorrow is not past",
			new Date(2026, 7, 23),
			new Date(2026, 7, 22),
			false,
		],
		[
			"across a month boundary",
			new Date(2026, 6, 31),
			new Date(2026, 7, 1),
			true,
		],
		[
			"across a year boundary",
			new Date(2025, 11, 31),
			new Date(2026, 0, 1),
			true,
		],
	];

	for (const [label, date, now, expected] of cases) {
		it(label, () => {
			expect(isPast(date, now)).toBe(expected);
		});
	}
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
