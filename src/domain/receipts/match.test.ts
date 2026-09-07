import { describe, expect, it } from "vitest";

import {
	type MatchTransaction,
	matchCandidates,
	matchScanWindow,
} from "./match";

// Local midnight, matching the app-wide local-calendar convention (toDateInput).
function day(year: number, month: number, date: number) {
	return new Date(year, month - 1, date);
}

// The runner's own zone: with it, a local-midnight fixture resolves to the day it
// literally reads as, so the tolerance/ranking cases stay about tolerance and ranking.
// The zone-specific cases below name their zone explicitly.
const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;

function tx(
	over: Partial<MatchTransaction> & { id: number },
): MatchTransaction {
	return {
		description: "Woolworths",
		amount: 100,
		date: day(2026, 9, 10),
		hasReceipt: false,
		...over,
	};
}

const receipt = { total: 100, receiptDate: "2026-09-10" };

describe("matchCandidates — amount tolerance", () => {
	const cases: { name: string; amount: number; kept: boolean }[] = [
		{ name: "exact amount", amount: 100, kept: true },
		{ name: "+2% exactly (boundary inclusive)", amount: 102, kept: true },
		{ name: "-2% exactly (boundary inclusive)", amount: 98, kept: true },
		{ name: "just over +2%", amount: 102.01, kept: false },
		{ name: "just under -2%", amount: 97.99, kept: false },
		{
			name: "a refund never matches a spend receipt",
			amount: -100,
			kept: false,
		},
	];

	for (const c of cases) {
		it(`${c.name} → ${c.kept ? "kept" : "excluded"}`, () => {
			const result = matchCandidates(
				receipt,
				[tx({ id: 1, amount: c.amount })],
				LOCAL,
			);
			expect(result).toHaveLength(c.kept ? 1 : 0);
		});
	}
});

describe("matchCandidates — date window", () => {
	const cases: { name: string; date: Date; kept: boolean }[] = [
		{ name: "same day", date: day(2026, 9, 10), kept: true },
		{
			name: "+4 days (boundary inclusive)",
			date: day(2026, 9, 14),
			kept: true,
		},
		{ name: "-4 days (boundary inclusive)", date: day(2026, 9, 6), kept: true },
		{ name: "+5 days", date: day(2026, 9, 15), kept: false },
		{ name: "-5 days", date: day(2026, 9, 5), kept: false },
	];

	for (const c of cases) {
		it(`${c.name} → ${c.kept ? "kept" : "excluded"}`, () => {
			const result = matchCandidates(
				receipt,
				[tx({ id: 1, date: c.date })],
				LOCAL,
			);
			expect(result).toHaveLength(c.kept ? 1 : 0);
		});
	}

	it("ignores the time of day — a late-evening transaction is still same-day", () => {
		const evening = new Date(2026, 8, 14, 23, 30);
		expect(
			matchCandidates(receipt, [tx({ id: 1, date: evening })], LOCAL),
		).toHaveLength(1);
	});
});

// A transaction is an instant, so the day it counts as — and the gap the banner
// reports — depends on the zone. These pin that it's the caller's zone doing the
// work, not the server's (UTC in production, which is the bug these guard).
describe("matchCandidates — viewer time zone", () => {
	// 20:00 UTC on the 14th is already the 15th in Brisbane (UTC+10).
	const lateUtc = new Date("2026-09-14T20:00:00Z");

	it("keeps a transaction whose UTC day is +4 but drops it when the viewer is +10", () => {
		expect(
			matchCandidates(receipt, [tx({ id: 1, date: lateUtc })], "UTC"),
		).toHaveLength(1);
		expect(
			matchCandidates(
				receipt,
				[tx({ id: 1, date: lateUtc })],
				"Australia/Brisbane",
			),
		).toHaveLength(0);
	});

	it("reports the gap in the viewer's zone, not the runtime's", () => {
		// 14:00 UTC on the 10th is midnight on the 11th in Brisbane.
		const rows = [tx({ id: 1, date: new Date("2026-09-10T14:00:00Z") })];
		expect(matchCandidates(receipt, rows, "UTC")[0]?.dayDelta).toBe(0);
		expect(
			matchCandidates(receipt, rows, "Australia/Brisbane")[0]?.dayDelta,
		).toBe(1);
	});

	it("falls back to the runtime zone for a zone Intl doesn't know", () => {
		expect(matchCandidates(receipt, [tx({ id: 1 })], "Not/AZone")).toHaveLength(
			1,
		);
	});
});

describe("matchCandidates — exclusions", () => {
	it("excludes a transaction that already has a receipt", () => {
		const rows = [tx({ id: 1, hasReceipt: true }), tx({ id: 2 })];
		expect(matchCandidates(receipt, rows, LOCAL).map((c) => c.id)).toEqual([2]);
	});

	it("returns nothing when the receipt has no extracted total", () => {
		expect(
			matchCandidates(
				{ total: null, receiptDate: "2026-09-10" },
				[tx({ id: 1 })],
				LOCAL,
			),
		).toEqual([]);
	});

	it("returns nothing when the receipt has no extracted date", () => {
		expect(
			matchCandidates(
				{ total: 100, receiptDate: null },
				[tx({ id: 1 })],
				LOCAL,
			),
		).toEqual([]);
	});

	it("returns nothing when no transaction is in range", () => {
		expect(
			matchCandidates(receipt, [tx({ id: 1, amount: 500 })], LOCAL),
		).toEqual([]);
	});
});

describe("matchCandidates — ranking", () => {
	it("ranks closest amount first, then closest date", () => {
		const rows = [
			tx({ id: 1, amount: 101, date: day(2026, 9, 10) }),
			tx({ id: 2, amount: 100, date: day(2026, 9, 13) }),
			tx({ id: 3, amount: 100, date: day(2026, 9, 11) }),
		];
		expect(matchCandidates(receipt, rows, LOCAL).map((c) => c.id)).toEqual([
			3, 2, 1,
		]);
	});

	it("reports the gaps it ranked on — date gap signed, earlier is negative", () => {
		const rows = [tx({ id: 1, amount: 98.5, date: day(2026, 9, 8) })];
		expect(matchCandidates(receipt, rows, LOCAL)[0]).toMatchObject({
			amountDelta: 1.5,
			dayDelta: -2,
		});
	});

	it("breaks an exact tie on newest transaction first", () => {
		const rows = [tx({ id: 7 }), tx({ id: 9 })];
		expect(matchCandidates(receipt, rows, LOCAL).map((c) => c.id)).toEqual([
			9, 7,
		]);
	});
});

describe("matchScanWindow", () => {
	it("spans 5 days either side, upper bound half-open", () => {
		const window = matchScanWindow("2026-09-10");
		expect(window?.from).toEqual(day(2026, 9, 5));
		// 10 + 5 = the 15th is the last day in scope, so the bound is midnight the 16th.
		expect(window?.to).toEqual(day(2026, 9, 16));
	});

	// One day wider each side than the ±4 the ranking keeps — that slack is what lets
	// a viewer up to ~24h off the server still see every row the filter would keep.
	it("is wider than the match window it feeds", () => {
		const window = matchScanWindow("2026-09-10");
		expect(
			matchCandidates(receipt, [tx({ id: 1, date: day(2026, 9, 15) })], LOCAL),
		).toHaveLength(0);
		expect(window?.to.getTime()).toBeGreaterThan(day(2026, 9, 15).getTime());
	});

	it("returns null for a date it can't parse", () => {
		expect(matchScanWindow("not-a-date")).toBeNull();
	});
});
