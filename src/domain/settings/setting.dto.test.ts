import { describe, expect, it } from "vitest";
import { fortnightAnchorSetDto } from "./setting.dto";

describe("fortnightAnchorSetDto", () => {
	it("accepts a valid calendar date", () => {
		expect(
			fortnightAnchorSetDto.safeParse({ value: "2026-08-12" }).success,
		).toBe(true);
	});

	it("rejects an empty value", () => {
		expect(fortnightAnchorSetDto.safeParse({ value: "" }).success).toBe(false);
	});

	it("rejects non-date text", () => {
		expect(
			fortnightAnchorSetDto.safeParse({ value: "next payday" }).success,
		).toBe(false);
	});

	// A rolled-over date would parse into a different day than it names, so the
	// reader would hand the grid an anchor the member never chose.
	it("rejects a rolled-over month", () => {
		expect(
			fortnightAnchorSetDto.safeParse({ value: "2026-13-01" }).success,
		).toBe(false);
	});

	it("rejects a rolled-over day", () => {
		expect(
			fortnightAnchorSetDto.safeParse({ value: "2026-02-30" }).success,
		).toBe(false);
	});

	it("rejects a 2-digit year", () => {
		expect(fortnightAnchorSetDto.safeParse({ value: "26-08-12" }).success).toBe(
			false,
		);
	});

	// These name a real day, so the chart would grid off them happily — but
	// <input type="date"> renders them blank, leaving the member looking at an
	// empty field that re-saves the same unusable string.
	it.each(["2026-8-12", " 2026-08-12", "+002026-08-12", "2026-08-12 "])(
		"rejects the unpadded/padded-junk shape %j",
		(value) => {
			expect(fortnightAnchorSetDto.safeParse({ value }).success).toBe(false);
		},
	);
});
