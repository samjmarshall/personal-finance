import { describe, expect, it } from "vitest";

import { type MatchTransaction, matchCandidates } from "./match";

// Local midnight, matching the app-wide local-calendar convention (toDateInput).
function day(year: number, month: number, date: number) {
	return new Date(year, month - 1, date);
}

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
			const result = matchCandidates(receipt, [
				tx({ id: 1, amount: c.amount }),
			]);
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
			const result = matchCandidates(receipt, [tx({ id: 1, date: c.date })]);
			expect(result).toHaveLength(c.kept ? 1 : 0);
		});
	}

	it("ignores the time of day — a late-evening transaction is still same-day", () => {
		const evening = new Date(2026, 8, 14, 23, 30);
		expect(
			matchCandidates(receipt, [tx({ id: 1, date: evening })]),
		).toHaveLength(1);
	});
});

describe("matchCandidates — exclusions", () => {
	it("excludes a transaction that already has a receipt", () => {
		const rows = [tx({ id: 1, hasReceipt: true }), tx({ id: 2 })];
		expect(matchCandidates(receipt, rows).map((c) => c.id)).toEqual([2]);
	});

	it("returns nothing when the receipt has no extracted total", () => {
		expect(
			matchCandidates({ total: null, receiptDate: "2026-09-10" }, [
				tx({ id: 1 }),
			]),
		).toEqual([]);
	});

	it("returns nothing when the receipt has no extracted date", () => {
		expect(
			matchCandidates({ total: 100, receiptDate: null }, [tx({ id: 1 })]),
		).toEqual([]);
	});

	it("returns nothing when no transaction is in range", () => {
		expect(matchCandidates(receipt, [tx({ id: 1, amount: 500 })])).toEqual([]);
	});
});

describe("matchCandidates — ranking", () => {
	it("ranks closest amount first, then closest date", () => {
		const rows = [
			tx({ id: 1, amount: 101, date: day(2026, 9, 10) }),
			tx({ id: 2, amount: 100, date: day(2026, 9, 13) }),
			tx({ id: 3, amount: 100, date: day(2026, 9, 11) }),
		];
		expect(matchCandidates(receipt, rows).map((c) => c.id)).toEqual([3, 2, 1]);
	});

	it("reports the gaps it ranked on — date gap signed, earlier is negative", () => {
		const rows = [tx({ id: 1, amount: 98.5, date: day(2026, 9, 8) })];
		expect(matchCandidates(receipt, rows)[0]).toMatchObject({
			amountDelta: 1.5,
			dayDelta: -2,
		});
	});

	it("breaks an exact tie on newest transaction first", () => {
		const rows = [tx({ id: 7 }), tx({ id: 9 })];
		expect(matchCandidates(receipt, rows).map((c) => c.id)).toEqual([9, 7]);
	});
});
