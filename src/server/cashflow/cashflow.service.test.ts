import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import { type BuildCashflowInput, buildCashflow } from "~/domain/cashflow";
import type { Expense } from "~/domain/expenses";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { recorder, throwing } from "~/test/fakes";
import { CashflowService } from "./cashflow.service";

type Ports = ConstructorParameters<typeof CashflowService>[0];

const NOW = new Date("2026-10-07T12:00:00.000Z");

const RENT: Expense = {
	id: 1,
	name: "Rent",
	categoryId: 1,
	kind: CommitmentKind.Recurring,
	fortnight: 0,
	month: 2000,
	year: 24000,
	amount: null,
	expectedDate: null,
	dueDay: 15,
	dueMonth: null,
	sortOrder: 0,
	createdAt: NOW,
	updatedAt: null,
};

const CAR_SERVICE: Expense = {
	...RENT,
	id: 2,
	name: "Car service",
	categoryId: 2,
	kind: CommitmentKind.OneTime,
	month: 0,
	year: 0,
	amount: 500,
	expectedDate: new Date("2026-10-10T00:00:00.000Z"),
	dueDay: null,
};

const SALARY: Income = {
	id: 1,
	person: "Sam",
	source: "Salary",
	kind: CommitmentKind.Recurring,
	fortnight: 0,
	month: 5000,
	year: 60000,
	amount: null,
	expectedDate: null,
	dueDay: 14,
	dueMonth: null,
	sortOrder: 0,
	createdAt: NOW,
	updatedAt: null,
};

const SNAPSHOT: BalanceSnapshot = {
	id: 1,
	amount: 3000,
	asOf: new Date("2026-10-05T00:00:00.000Z"),
	createdAt: new Date("2026-10-05T01:00:00.000Z"),
};

const TRANSACTIONS = [
	{ date: new Date("2026-09-01T12:00:00.000Z"), amount: 80 },
	{ date: new Date("2026-09-02T12:00:00.000Z"), amount: -20 },
];

const ANCHOR = "2026-08-26";

// get() always makes all six reads, so every port resolves a fixture by default.
function serviceWith(staged: { [K in keyof Ports]?: Partial<Ports[K]> } = {}) {
	return new CashflowService({
		transactions: {
			datedAmounts: async () => TRANSACTIONS,
			consumedByExpense: async () => [{ expenseId: 2, consumed: 120 }],
			...staged.transactions,
		},
		expenses: { list: async () => [RENT, CAR_SERVICE], ...staged.expenses },
		income: { list: async () => [SALARY], ...staged.income },
		settings: { fortnightAnchor: async () => ANCHOR, ...staged.settings },
		balances: { latest: async () => SNAPSHOT, ...staged.balances },
	});
}

function expected(overrides: Partial<BuildCashflowInput> = {}) {
	return buildCashflow({
		now: NOW,
		periodKind: "fortnight",
		fortnightAnchor: new Date("2026-08-26T00:00:00.000Z"),
		transactions: TRANSACTIONS,
		expenses: [RENT, CAR_SERVICE],
		incomes: [SALARY],
		consumedByExpenseId: new Map([[2, 120]]),
		anchor: { amount: SNAPSHOT.amount, asOf: SNAPSHOT.asOf },
		...overrides,
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("get", () => {
	it("hands the five services' reads to the compute", async () => {
		const result = await serviceWith().get("fortnight");

		expect(result).toEqual(expected());
		expect(result.hasBalanceAnchor).toBe(true);
		expect(result.buckets).toHaveLength(25);
		const historic = result.buckets.filter((b) => b.key <= "2026-09-01").pop();
		expect(historic).toMatchObject({ spend: 80, inflow: 20, items: [] });
		const current = result.buckets.find((b) => b.isCurrent);
		expect(current?.items.map((item) => item.label)).toEqual([
			"Rent",
			"Car service",
			"Salary",
		]);
	});

	it("starts each fortnight on the anchor day east of UTC", async () => {
		vi.stubEnv("TZ", "Australia/Brisbane");

		const { buckets } = await serviceWith().get("fortnight");

		// 26 Aug + 3 fortnights = 7 Oct, the current bucket.
		expect(buckets.find((b) => b.isCurrent)?.key).toBe("2026-10-07");
	});

	it("passes the period kind through", async () => {
		await expect(serviceWith().get("month")).resolves.toEqual(
			expected({ periodKind: "month" }),
		);
	});

	it("calls each read once, with no arguments", async () => {
		const datedAmounts = recorder(TRANSACTIONS);
		const consumedByExpense = recorder([]);
		const expenseList = recorder([]);
		const incomeList = recorder([]);
		const fortnightAnchor = recorder(null);
		const latest = recorder(null);

		await serviceWith({
			transactions: {
				datedAmounts: datedAmounts.method,
				consumedByExpense: consumedByExpense.method,
			},
			expenses: { list: expenseList.method },
			income: { list: incomeList.method },
			settings: { fortnightAnchor: fortnightAnchor.method },
			balances: { latest: latest.method },
		}).get("fortnight");

		for (const { calls } of [
			datedAmounts,
			consumedByExpense,
			expenseList,
			incomeList,
			fortnightAnchor,
			latest,
		]) {
			expect(calls).toEqual([[]]);
		}
	});

	it("falls back to the month grid with no anchor", async () => {
		const service = serviceWith({
			settings: { fortnightAnchor: async () => null },
		});

		await expect(service.get("fortnight")).resolves.toEqual(
			expected({ fortnightAnchor: null }),
		);
	});

	it("leaves the balance line off with no snapshot", async () => {
		const service = serviceWith({ balances: { latest: async () => null } });

		const result = await service.get("fortnight");

		expect(result).toEqual(expected({ anchor: null }));
		expect(result.hasBalanceAnchor).toBe(false);
	});

	it("lets a failed read propagate", async () => {
		const error = new Error("connection lost");
		const service = serviceWith({ expenses: { list: throwing(error) } });

		await expect(service.get("fortnight")).rejects.toBe(error);
	});
});
