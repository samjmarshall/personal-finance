import { describe, expect, it } from "vitest";
import type { Expense } from "~/domain/expenses";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { type BuildCashflowInput, buildCashflow } from "./cashflow";

// A fixed "now" for every case: midday 20 Aug 2026. On a month grid the current
// bucket is Aug 2026 at index 12 (12 back · current · 12 forward = 25).
const NOW = new Date(2026, 7, 20, 12, 0);

function run(overrides: Partial<BuildCashflowInput> = {}) {
	return buildCashflow({
		now: NOW,
		periodKind: "month",
		fortnightAnchor: null,
		transactions: [],
		expenses: [],
		incomes: [],
		consumedByExpenseId: new Map(),
		anchor: null,
		...overrides,
	});
}

// Minimal builders — only the fields the projection reads matter; the rest carry
// harmless defaults so a case reads as its one varied dimension.
function expense(o: Partial<Expense>): Expense {
	return {
		id: 1,
		name: "Expense",
		category: "Bills & Subscriptions",
		kind: CommitmentKind.Recurring,
		fortnight: 0,
		month: 0,
		year: 0,
		amount: null,
		expectedDate: null,
		dueDay: null,
		dueMonth: null,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: null,
		...o,
	};
}

function income(o: Partial<Income>): Income {
	return {
		id: 1,
		person: "Person",
		source: "Income",
		kind: CommitmentKind.Recurring,
		fortnight: 0,
		month: 0,
		year: 0,
		amount: null,
		expectedDate: null,
		dueDay: null,
		dueMonth: null,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: null,
		...o,
	};
}

describe("buildCashflow — grid", () => {
	it("returns 25 ordered buckets with the current bucket in the middle", () => {
		const { buckets } = run();
		expect(buckets).toHaveLength(25);
		expect(buckets[12]?.isCurrent).toBe(true);
		expect(buckets[0]?.isCurrent).toBe(false);
		expect(buckets[12]?.key).toBe("2026-08-01");
		expect(buckets[12]?.label).toBe("Aug");
		expect(buckets[0]?.key).toBe("2025-08-01");
		expect(buckets[24]?.key).toBe("2027-08-01");
		const keys = buckets.map((b) => b.key);
		expect([...keys].sort()).toEqual(keys); // already ascending
	});

	it("degrades a fortnight request to the month grid when the anchor is null", () => {
		const { buckets } = run({ periodKind: "fortnight", fortnightAnchor: null });
		expect(buckets).toHaveLength(25);
		expect(buckets[12]?.key).toBe("2026-08-01");
		expect(buckets[13]?.key).toBe("2026-09-01");
		expect(buckets[12]?.label).toBe("Aug"); // month label, not "20 Aug"
	});

	it("uses the fortnight grid and day-month labels when an anchor is set", () => {
		const { buckets } = run({
			periodKind: "fortnight",
			fortnightAnchor: new Date(2026, 7, 14), // payday 14 Aug 2026
		});
		expect(buckets).toHaveLength(25);
		expect(buckets[12]?.key).toBe("2026-08-14");
		expect(buckets[12]?.isCurrent).toBe(true);
		expect(buckets[12]?.label).toBe("14 Aug");
		expect(buckets[13]?.key).toBe("2026-08-28");
	});
});

describe("buildCashflow — historic actuals", () => {
	it("nets a historic bucket into Spend and Inflow separately", () => {
		const { buckets } = run({
			transactions: [
				{ date: new Date(2026, 6, 5), amount: 100 }, // Spend
				{ date: new Date(2026, 6, 6), amount: -40 }, // Inflow (refund/credit)
			],
		});
		const july = buckets[11]; // 2026-07
		expect(july?.key).toBe("2026-07-01");
		expect(july?.spend).toBe(100);
		expect(july?.inflow).toBe(40);
		// a bucket with no transactions stays zeroed
		expect(buckets[9]?.spend).toBe(0);
		expect(buckets[9]?.inflow).toBe(0);
	});
});

describe("buildCashflow — recurring annual spike (dueMonth)", () => {
	it("lands the year figure once, in the due month's forward bucket", () => {
		const { buckets } = run({
			expenses: [expense({ dueMonth: 6, month: 100, year: 1200 })],
		});
		const june2027 = buckets[22]; // Aug26=12 … Jun27=22
		expect(june2027?.key).toBe("2027-06-01");
		expect(june2027?.spend).toBe(1200);
		expect(june2027?.items).toEqual([{ label: "Expense", amount: 1200 }]);
		// every other forward bucket is untouched
		expect(buckets[21]?.spend).toBe(0);
		expect(buckets[23]?.spend).toBe(0);
	});

	it("clamps the due day to month-end so it never rolls into the next month", () => {
		const { buckets } = run({
			expenses: [expense({ dueMonth: 2, dueDay: 31, month: 50, year: 600 })],
		});
		const feb2027 = buckets[18]; // Feb 2027
		const mar2027 = buckets[19];
		expect(feb2027?.key).toBe("2027-02-01");
		expect(feb2027?.spend).toBe(600); // clamped to 28 Feb, stays in Feb
		expect(mar2027?.spend).toBe(0); // no roll-forward
	});
});

describe("buildCashflow — recurring monthly spike (dueDay)", () => {
	it("lands the month figure in every forward month's bucket", () => {
		const { buckets } = run({
			expenses: [expense({ dueDay: 15, month: 200, year: 2400 })],
		});
		expect(buckets[13]?.spend).toBe(200); // Sep 2026
		expect(buckets[14]?.spend).toBe(200); // Oct 2026
		expect(buckets[11]?.spend).toBe(0); // historic July: not projected
	});

	it("clamps the due day per month (31 → month-end)", () => {
		const { buckets } = run({
			expenses: [expense({ dueDay: 31, month: 200, year: 2400 })],
		});
		expect(buckets[18]?.spend).toBe(200); // Feb 2027 clamps to the 28th
		expect(buckets[19]?.spend).toBe(200); // March also gets exactly one
	});
});

describe("buildCashflow — untimed smear", () => {
	it("prorates the year figure by bucket-days and conserves the annual total", () => {
		const { buckets } = run({
			expenses: [expense({ month: 300, year: 3650 })],
		});
		expect(buckets[13]?.spend).toBeCloseTo(300, 6); // Sep 2026: 3650×30/365
		const forwardSum = buckets
			.slice(13, 25)
			.reduce((sum, b) => sum + b.spend, 0);
		expect(forwardSum).toBeCloseTo(3650, 6); // Sep 2026 … Aug 2027 ≈ year
	});

	it("smears ≈ the fortnight figure per fortnight bucket", () => {
		const { buckets } = run({
			periodKind: "fortnight",
			fortnightAnchor: new Date(2026, 7, 14),
			expenses: [expense({ fortnight: 140, year: 3650 })],
		});
		expect(buckets[13]?.spend).toBeCloseTo(140, 6); // 3650×14/365
	});
});

describe("buildCashflow — one-time expense remaining", () => {
	it("projects amount − consumed in the expected-date bucket", () => {
		const { buckets } = run({
			expenses: [
				expense({
					id: 7,
					kind: CommitmentKind.OneTime,
					amount: 500,
					expectedDate: new Date(2026, 9, 15), // 15 Oct 2026
				}),
			],
			consumedByExpenseId: new Map([[7, 200]]),
		});
		expect(buckets[14]?.key).toBe("2026-10-01");
		expect(buckets[14]?.spend).toBe(300);
		expect(buckets[14]?.items).toEqual([{ label: "Expense", amount: 300 }]);
	});

	it("shows nothing when fully consumed", () => {
		const { buckets } = run({
			expenses: [
				expense({
					id: 7,
					kind: CommitmentKind.OneTime,
					amount: 500,
					expectedDate: new Date(2026, 9, 15),
				}),
			],
			consumedByExpenseId: new Map([[7, 500]]),
		});
		expect(buckets[14]?.spend).toBe(0);
		expect(buckets[14]?.items).toEqual([]);
	});

	it("rolls a past, still-unconsumed remaining into the current bucket", () => {
		const { buckets } = run({
			expenses: [
				expense({
					id: 7,
					kind: CommitmentKind.OneTime,
					amount: 500,
					expectedDate: new Date(2026, 6, 5), // 5 Jul 2026 (past)
				}),
			],
			consumedByExpenseId: new Map([[7, 100]]),
		});
		expect(buckets[12]?.spend).toBe(400); // rolled into current
		expect(buckets[11]?.spend).toBe(0); // not left in its historic bucket
	});

	it("drops a past, fully-consumed one-time expense entirely", () => {
		const { buckets } = run({
			expenses: [
				expense({
					id: 7,
					kind: CommitmentKind.OneTime,
					amount: 500,
					expectedDate: new Date(2026, 6, 5),
				}),
			],
			consumedByExpenseId: new Map([[7, 500]]),
		});
		expect(buckets[12]?.spend).toBe(0);
	});
});

describe("buildCashflow — one-time income", () => {
	it("projects the full amount in the expected-date bucket as Inflow", () => {
		const { buckets } = run({
			incomes: [
				income({
					kind: CommitmentKind.OneTime,
					amount: 1000,
					expectedDate: new Date(2026, 9, 15),
				}),
			],
		});
		expect(buckets[14]?.inflow).toBe(1000);
		expect(buckets[14]?.items).toEqual([{ label: "Income", amount: -1000 }]);
	});

	it("drops a past one-time income (assumed received)", () => {
		const { buckets } = run({
			incomes: [
				income({
					kind: CommitmentKind.OneTime,
					amount: 1000,
					expectedDate: new Date(2026, 6, 5),
				}),
			],
		});
		expect(buckets.every((b) => b.inflow === 0)).toBe(true);
	});
});

describe("buildCashflow — today-straddle (current bucket)", () => {
	it("sums elapsed actuals plus spikes landing later this bucket", () => {
		const { buckets } = run({
			transactions: [{ date: new Date(2026, 7, 5), amount: 300 }], // 5 Aug, elapsed
			expenses: [expense({ dueDay: 25, month: 600, year: 7200 })], // lands 25 Aug > now
		});
		expect(buckets[12]?.spend).toBe(900); // 300 actual + 600 projected
	});

	it("excludes a spike whose landing has already elapsed", () => {
		const { buckets } = run({
			transactions: [{ date: new Date(2026, 7, 5), amount: 300 }],
			expenses: [expense({ dueDay: 5, month: 400, year: 4800 })], // lands 5 Aug ≤ now
		});
		expect(buckets[12]?.spend).toBe(300); // spike assumed already in actuals
	});

	it("prorates an untimed smear to the days remaining after today", () => {
		const { buckets } = run({
			expenses: [expense({ year: 3650 })], // ~10/day
		});
		// Aug 2026: days strictly after the 20th = 21st…31st = 11 days → 3650×11/365
		expect(buckets[12]?.spend).toBeCloseTo(110, 6);
	});
});

describe("buildCashflow — balance line", () => {
	it("pivots on the anchor and stays continuous both directions", () => {
		const { buckets, hasBalanceAnchor } = run({
			anchor: { amount: 1000, asOf: new Date(2026, 7, 20) }, // pivot = current bucket
			transactions: [{ date: new Date(2026, 6, 10), amount: 250 }], // Jul Spend
			incomes: [income({ dueDay: 1, month: 500, year: 6000 })], // +500 on the 1st
			expenses: [expense({ dueDay: 15, month: 200, year: 2400 })], // −200 on the 15th
		});
		expect(hasBalanceAnchor).toBe(true);
		expect(buckets[12]?.balance).toBe(1000); // anchor, both timed items already elapsed
		expect(buckets[13]?.balance).toBe(1300); // Sep net +500 − 200
		expect(buckets[11]?.balance).toBe(1000); // Jul Spend reverses back through the pivot
		expect(buckets[10]?.balance).toBe(1250); // before the Jul 250 Spend
	});

	it("returns a null balance line and no anchor when there is no snapshot", () => {
		const { buckets, hasBalanceAnchor } = run({
			expenses: [expense({ dueDay: 15, month: 200, year: 2400 })],
		});
		expect(hasBalanceAnchor).toBe(false);
		expect(buckets.every((b) => b.balance === null)).toBe(true);
	});
});
