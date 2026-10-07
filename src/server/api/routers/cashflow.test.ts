import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BalanceSnapshot } from "~/domain/balances";
import { type BuildCashflowInput, buildCashflow } from "~/domain/cashflow";
import type { Expense } from "~/domain/expenses";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { fromDateInput } from "~/lib/utils";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { balanceSnapshots } from "~/server/balances/balances.schema";
import { recordingDb, rowOf } from "~/server/db/recording-db.fake";
import { expenses } from "~/server/expenses/expenses.schema";
import { income } from "~/server/income/income.schema";
import { cashflowRouter } from "./cashflow";

// Characterizes the router before it moves to src/server/cashflow/: the SQL it
// sends and the result it builds must survive the move unchanged.

const router = createTRPCRouter({ cashflow: cashflowRouter });

const NOW = new Date("2026-10-07T12:00:00.000Z");

const RENT = {
	id: 1,
	name: "Rent",
	category: "Bills & Subscriptions",
	kind: CommitmentKind.Recurring,
	fortnight: 0,
	month: 2000,
	year: 24000,
	amount: null,
	expectedDate: null,
	dueDay: 15,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: null,
} satisfies Expense;

const CAR_SERVICE = {
	id: 2,
	name: "Car service",
	category: "Transport",
	kind: CommitmentKind.OneTime,
	fortnight: 0,
	month: 0,
	year: 0,
	amount: 500,
	expectedDate: new Date("2026-10-10T00:00:00.000Z"),
	dueDay: null,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: null,
} satisfies Expense;

const SALARY = {
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
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: null,
} satisfies Income;

const SNAPSHOT = {
	id: 1,
	amount: 3000,
	asOf: new Date("2026-10-05T00:00:00.000Z"),
	createdAt: new Date("2026-10-05T01:00:00.000Z"),
} satisfies BalanceSnapshot;

// One historic Spend and one historic Inflow, both in the bucket holding 1 Sep.
const TRANSACTIONS = [
	{ date: new Date("2026-09-01T12:00:00.000Z"), amount: 80 },
	{ date: new Date("2026-09-02T12:00:00.000Z"), amount: -20 },
];

// Staged in the Planned page order (category, sort order, name), so a list
// that sorts returns them unchanged.
const ROWS = {
	consumption: [[2, "120"]],
	transactions: TRANSACTIONS.map((t) => rowOf(["date", "amount"], t)),
	expenses: [RENT, CAR_SERVICE].map((e) =>
		rowOf(Object.keys(getTableColumns(expenses)), e),
	),
	incomes: [rowOf(Object.keys(getTableColumns(income)), SALARY)],
	anchor: [["2026-08-26"]],
	snapshot: [rowOf(Object.keys(getTableColumns(balanceSnapshots)), SNAPSHOT)],
};
type Slot = keyof typeof ROWS;

// The consumption select also reads from "transaction", so match it first.
function slotOf(sql: string): Slot {
	if (sql.includes(" group by ")) return "consumption";
	if (sql.includes('from "transaction"')) return "transactions";
	if (sql.includes('from "expense"')) return "expenses";
	if (sql.includes('from "income"')) return "incomes";
	if (sql.includes('from "app_setting"')) return "anchor";
	if (sql.includes('from "balance_snapshot"')) return "snapshot";
	throw new Error(`unexpected query: ${sql}`);
}

function harness(
	staged: Partial<Record<Slot, unknown[][] | Error>> = {},
	session: { user: { id: string } } | null = { user: { id: "member-1" } },
) {
	const { db, queries } = recordingDb(({ sql }) => {
		const slot = slotOf(sql);
		return staged[slot] ?? ROWS[slot];
	});
	const caller = createCallerFactory(router)({
		db,
		session,
		services: {},
		headers: new Headers(),
	} as never);
	return { cashflow: caller.cashflow, queries };
}

function expected(overrides: Partial<BuildCashflowInput> = {}) {
	return buildCashflow({
		now: NOW,
		periodKind: "fortnight",
		fortnightAnchor: fromDateInput("2026-08-26"),
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
afterEach(() => vi.useRealTimers());

describe("cashflow.get", () => {
	it("builds the fortnight grid from the six reads", async () => {
		const { cashflow, queries } = harness();

		const result = await cashflow.get({ periodKind: "fortnight" });

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
		expect(
			queries
				.map(({ sql, params }) => ({ sql, params }))
				.sort((a, b) => a.sql.localeCompare(b.sql)),
		).toMatchInlineSnapshot(`
			[
			  {
			    "params": [],
			    "sql": "select "date", "amount" from "transaction"",
			  },
			  {
			    "params": [],
			    "sql": "select "expenseId", coalesce(sum("amount"), 0) from "transaction" where "transaction"."expenseId" is not null group by "transaction"."expenseId"",
			  },
			  {
			    "params": [
			      1,
			    ],
			    "sql": "select "id", "amount", "asOf", "createdAt" from "balance_snapshot" order by "balance_snapshot"."asOf" desc, "balance_snapshot"."id" desc limit $1",
			  },
			  {
			    "params": [],
			    "sql": "select "id", "name", "category", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt" from "expense"",
			  },
			  {
			    "params": [],
			    "sql": "select "id", "person", "source", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt" from "income"",
			  },
			  {
			    "params": [
			      "fortnightAnchor",
			    ],
			    "sql": "select "value" from "app_setting" where "app_setting"."key" = $1",
			  },
			]
		`);
	});

	it("defaults to the fortnight grid", async () => {
		const { cashflow } = harness();

		await expect(cashflow.get({})).resolves.toEqual(expected());
	});

	it("builds the month grid", async () => {
		const { cashflow } = harness();

		await expect(cashflow.get({ periodKind: "month" })).resolves.toEqual(
			expected({ periodKind: "month" }),
		);
	});

	it.each([
		["no anchor row", []],
		["an invalid stored anchor", [["2026-02-30"]]],
	])("falls back to the month grid with %s", async (_, anchor) => {
		const { cashflow } = harness({ anchor });

		const result = await cashflow.get({ periodKind: "fortnight" });

		expect(result).toEqual(expected({ fortnightAnchor: null }));
		expect(result).toEqual(
			expected({ periodKind: "month", fortnightAnchor: null }),
		);
	});

	it("leaves the balance line off with no snapshot", async () => {
		const { cashflow } = harness({ snapshot: [] });

		const result = await cashflow.get({ periodKind: "fortnight" });

		expect(result).toEqual(expected({ anchor: null }));
		expect(result.hasBalanceAnchor).toBe(false);
	});

	it("fails as a 500 when a read fails", async () => {
		const { cashflow } = harness({ expenses: new Error("connection lost") });

		await expect(
			cashflow.get({ periodKind: "fortnight" }),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});

	it("rejects an unknown period kind before any query", async () => {
		const { cashflow, queries } = harness();

		await expect(
			cashflow.get({ periodKind: "week" as never }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(queries).toEqual([]);
	});

	it("rejects a signed-out caller before any query", async () => {
		const { cashflow, queries } = harness({}, null);

		await expect(
			cashflow.get({ periodKind: "fortnight" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(queries).toEqual([]);
	});
});
