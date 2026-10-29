import { describe, expect, it } from "vitest";
import { CdrImportStatus } from "~/lib/constants";
import {
	amountGapLabel,
	dayGapLabel,
	importCounts,
	importRange,
	importStatusLabel,
} from "./import.display";

describe("importStatusLabel", () => {
	it.each([
		[CdrImportStatus.Queued, true, "Waiting to start"],
		[CdrImportStatus.Running, true, "Importing"],
		[CdrImportStatus.Done, false, "Done"],
		[CdrImportStatus.Failed, false, "Failed"],
		// The server gave up on it, so the form is open again.
		[CdrImportStatus.Queued, false, "Didn't finish"],
		[CdrImportStatus.Running, false, "Didn't finish"],
	])("%s, active %s → %s", (status, active, label) => {
		expect(importStatusLabel({ status, active })).toBe(label);
	});
});

describe("importCounts", () => {
	it("names each count in member words", () => {
		expect(
			importCounts({ added: 12, adopted: 30, flagged: 3, known: 950 }),
		).toEqual([
			"Added 12",
			"Matched to yours 30",
			"To review 3",
			"Already here 950",
		]);
	});

	it("groups thousands", () => {
		expect(
			importCounts({ added: 1200, adopted: 0, flagged: 0, known: 0 }),
		).toEqual([
			"Added 1,200",
			"Matched to yours 0",
			"To review 0",
			"Already here 0",
		]);
	});

	// Below zero when it cleared more older reviews than it made.
	it("never shows fewer than zero to review", () => {
		expect(
			importCounts({ added: 2, adopted: 2, flagged: -2, known: 0 }),
		).toContain("To review 0");
	});
});

describe("importRange", () => {
	// A bare day: a member west of UTC must not see the day before.
	it("shows the stored UTC days as they are", () => {
		expect(
			importRange({
				fromDate: new Date("2026-01-01T00:00:00.000Z"),
				toDate: new Date("2026-03-31T00:00:00.000Z"),
			}),
		).toBe("01 Jan 2026 – 31 Mar 2026");
	});
});

describe("dayGapLabel", () => {
	const mine = new Date("2026-02-01T13:00:00.000Z"); // 2 Feb in Sydney

	it.each([
		["2026-02-04T13:00:00.000Z", "3 days later"],
		["2026-02-02T13:00:00.000Z", "1 day later"],
		["2026-01-29T13:00:00.000Z", "3 days earlier"],
		["2026-01-31T13:00:00.000Z", "1 day earlier"],
	])("bank on %s → %s", (bank, label) => {
		expect(dayGapLabel(new Date(bank), mine)).toBe(label);
	});

	it("is null on the same household day", () => {
		expect(dayGapLabel(new Date("2026-02-01T20:00:00.000Z"), mine)).toBeNull();
	});
});

describe("amountGapLabel", () => {
	it.each([
		[51.2, 50, "$1.20 more"],
		[48.8, 50, "$1.20 less"],
		// A refund: size, not sign, says more or less.
		[-51.2, -50, "$1.20 more"],
	])("bank %s vs mine %s → %s", (bank, mine, label) => {
		expect(amountGapLabel(bank, mine)).toBe(label);
	});

	it("is null to the cent", () => {
		expect(amountGapLabel(0.1 + 0.2, 0.3)).toBeNull();
	});
});
