import { describe, expect, it } from "vitest";
import type { PossibleDuplicateReview } from "~/domain/transactions";
import { CdrImportStatus, Provenance } from "~/lib/constants";
import {
	amountGapLabel,
	appliedLabel,
	dayGapLabel,
	duplicatePiles,
	fillLabel,
	importCountLabels,
	importRangeLabel,
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

describe("importCountLabels", () => {
	it("names each count in member words", () => {
		expect(
			importCountLabels({ added: 12, adopted: 30, flagged: 3, known: 950 }),
		).toEqual([
			"Added 12",
			"Matched to yours 30",
			"Flagged 3",
			"Already here 950",
		]);
	});

	it("groups thousands", () => {
		expect(
			importCountLabels({ added: 1200, adopted: 0, flagged: 0, known: 0 }),
		).toEqual([
			"Added 1,200",
			"Matched to yours 0",
			"Flagged 0",
			"Already here 0",
		]);
	});

	// Below zero when it cleared more older reviews than it made.
	it("never shows fewer than zero to review", () => {
		expect(
			importCountLabels({ added: 2, adopted: 2, flagged: -2, known: 0 }),
		).toContain("Flagged 0");
	});
});

describe("importRangeLabel", () => {
	// A bare day: a member west of UTC must not see the day before.
	it("shows the stored UTC days as they are", () => {
		expect(
			importRangeLabel({
				fromDate: new Date("2026-01-01T00:00:00.000Z"),
				toDate: new Date("2026-03-31T00:00:00.000Z"),
			}),
		).toBe("01 Jan 2026 – 31 Mar 2026");
	});
});

describe("dayGapLabel", () => {
	const mine = new Date("2026-02-01T13:00:00.000Z"); // 2 Feb in Sydney

	it.each([
		["2026-02-04T13:00:00.000Z", "3 days later than yours"],
		["2026-02-02T13:00:00.000Z", "1 day later than yours"],
		["2026-01-29T13:00:00.000Z", "3 days earlier than yours"],
		["2026-01-31T13:00:00.000Z", "1 day earlier than yours"],
	])("bank on %s → %s", (bank, label) => {
		expect(dayGapLabel(new Date(bank), mine)).toBe(label);
	});

	it("is null on the same household day", () => {
		expect(dayGapLabel(new Date("2026-02-01T20:00:00.000Z"), mine)).toBeNull();
	});
});

describe("amountGapLabel", () => {
	it.each([
		[51.2, 50, "$1.20 more than yours"],
		[48.8, 50, "$1.20 less than yours"],
		// A refund: size, not sign, says more or less.
		[-51.2, -50, "$1.20 more than yours"],
	])("bank %s vs mine %s → %s", (bank, mine, label) => {
		expect(amountGapLabel(bank, mine)).toBe(label);
	});

	it("is null to the cent", () => {
		expect(amountGapLabel(0.1 + 0.2, 0.3)).toBeNull();
	});
});

// Bank days are UTC midnight; yours are Sydney midnight (13:00 UTC the day before, AEDT).
function review(
	id: number,
	{
		bankDay,
		mineDay,
		bank = "BANK",
		mine = "Mine",
	}: { bankDay: string; mineDay: string; bank?: string; mine?: string },
): PossibleDuplicateReview {
	const mineDate = new Date(`${mineDay}T00:00:00.000Z`);
	mineDate.setUTCHours(-11);
	return {
		id,
		bank: {
			date: new Date(`${bankDay}T00:00:00.000Z`),
			amount: 9,
			description: bank,
			accountName: "Everyday",
		},
		mine: {
			id: id + 100,
			date: mineDate,
			amount: 9,
			description: mine,
			accountName: null,
			provenance: Provenance.Manual,
		},
	};
}

const ids = (piles: ReturnType<typeof duplicatePiles>) =>
	piles.map((pile) => [pile.key, pile.reviews.map((r) => r.id)]);

describe("duplicatePiles", () => {
	it("puts 3 shared words in Similar and 2 in Different", () => {
		const netflix = review(1, {
			bankDay: "2026-01-13",
			mineDay: "2026-01-14",
			bank: "PAYPAL *NETFLIX AUS 4029357733 AUS",
			mine: "PAYPAL *NETFLIX AUS AUS",
		});
		const crossed = review(2, {
			bankDay: "2026-01-13",
			mineDay: "2026-01-14",
			bank: "PAYPAL *SPOTIFY*P3E65F 4029357733 AUS",
			mine: "PAYPAL *NETFLIX AUS AUS",
		});

		const piles = duplicatePiles([crossed, netflix]);

		expect(ids(piles)).toEqual([
			["similar_description", [1]],
			["different_description", [2]],
		]);
		expect(piles.map((pile) => pile.suggestion)).toEqual([
			"use_bank",
			"both_real",
		]);
	});

	it("sorts the nearest day first, then the newest", () => {
		const far = review(1, { bankDay: "2026-02-08", mineDay: "2026-02-03" });
		const sameDay = review(2, { bankDay: "2026-01-10", mineDay: "2026-01-10" });
		const oneOld = review(3, { bankDay: "2026-01-02", mineDay: "2026-01-01" });
		const oneNew = review(4, { bankDay: "2026-03-02", mineDay: "2026-03-01" });

		expect(ids(duplicatePiles([far, sameDay, oneOld, oneNew]))).toEqual([
			["different_description", [2, 4, 3, 1]],
		]);
	});

	it("leaves out a pile with no rows", () => {
		expect(duplicatePiles([])).toEqual([]);
	});
});

describe("fillLabel", () => {
	it.each([
		[12, 12, "Use bank's for all 12"],
		[4, 12, "Use bank's for the other 4"],
		[1, 12, "Use bank's for the last one"],
		[1, 1, "Use bank's for this one"],
		[0, 12, "All answered"],
	])("%i of %i unanswered → %s", (unanswered, total, label) => {
		expect(fillLabel("Use bank's", unanswered, total)).toBe(label);
	});
});

describe("appliedLabel", () => {
	it("counts what was applied", () => {
		expect(appliedLabel({ resolved: 1, gone: 0, taken: 0 })).toBe(
			"Applied 1 answer.",
		);
		expect(appliedLabel({ resolved: 3, gone: 0, taken: 0 })).toBe(
			"Applied 3 answers.",
		);
	});

	it("says which were already answered and which still need one", () => {
		expect(appliedLabel({ resolved: 2, gone: 1, taken: 2 })).toBe(
			"Applied 2 answers. 1 was already answered. 2 still need an answer: the bank's row is already in your transactions.",
		);
		expect(appliedLabel({ resolved: 0, gone: 2, taken: 1 })).toBe(
			"2 were already answered. 1 still needs an answer: the bank's row is already in your transactions.",
		);
	});
});
