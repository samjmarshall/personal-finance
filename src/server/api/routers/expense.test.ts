import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "~/domain/expenses";
import { CommitmentKind } from "~/lib/constants";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { type Respond, recordingDb } from "~/server/db/recording-db.fake";
import { expenses } from "~/server/expenses/expenses.schema";
import { expenseRouter } from "./expense";

// Characterizes the router before it moves to src/server/expenses/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ expense: expenseRouter });

function harness(
	respond?: Respond,
	session: { user: { id: string } } | null = { user: { id: "member-1" } },
) {
	const { db, queries } = recordingDb(respond);
	const caller = createCallerFactory(router)({
		db,
		session,
		services: {},
		headers: new Headers(),
	} as never);
	return { expense: caller.expense, queries };
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-10-02T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(expenses));

// Driver sends timestamps as text; drizzle parses them back into Dates.
function rowOf(fields: string[], fixture: Record<string, unknown>) {
	return fields.map((field) => {
		const value = fixture[field];
		return value instanceof Date ? value.toISOString() : (value ?? null);
	});
}

const EXPENSE = {
	id: 7,
	name: "Weekly shop",
	category: "Food",
	kind: CommitmentKind.Recurring,
	fortnight: 200,
	month: 433,
	year: 5200,
	amount: null,
	expectedDate: null,
	dueDay: null,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Expense;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("list", () => {
	it("selects every expense by category, sort order, then name", async () => {
		const { expense, queries } = harness(() => [rowOf(COLUMNS, EXPENSE)]);

		await expect(expense.list()).resolves.toEqual([EXPENSE]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "name", "category", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt" from "expense" order by "expense"."category" asc, "expense"."sortOrder" asc, "expense"."name" asc",
			  },
			]
		`);
	});
});

describe("create", () => {
	it("inserts the parsed input and returns the stored row", async () => {
		const { expense, queries } = harness(() => [rowOf(COLUMNS, EXPENSE)]);

		await expect(
			expense.create({ name: "Weekly shop", category: "Food", fortnight: 200 }),
		).resolves.toEqual(EXPENSE);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Weekly shop",
			      "Food",
			      200,
			      "2026-10-02T00:00:00.000Z",
			      "2026-10-02T00:00:00.000Z",
			    ],
			    "sql": "insert into "expense" ("id", "name", "category", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt") values (default, $1, $2, default, $3, default, default, default, default, default, default, default, $4, $5) returning "id", "name", "category", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("fails as a 500 when the insert returns no row", async () => {
		const { expense } = harness();

		await expect(
			expense.create({ name: "Weekly shop", category: "Food" }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create expense.",
		});
	});
});

describe("update", () => {
	const INPUT = {
		id: 7,
		name: "Weekly shop",
		category: "Food",
		kind: CommitmentKind.Recurring,
	};

	it("sets only the fields sent, so omitted amounts keep their stored value", async () => {
		const { expense, queries } = harness(() => [rowOf(COLUMNS, EXPENSE)]);

		await expect(expense.update(INPUT)).resolves.toEqual(EXPENSE);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Weekly shop",
			      "Food",
			      "recurring",
			      "2026-10-02T00:00:00.000Z",
			      7,
			    ],
			    "sql": "update "expense" set "name" = $1, "category" = $2, "kind" = $3, "updatedAt" = $4 where "expense"."id" = $5 returning "id", "name", "category", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	// A missing id is a 500, not NOT_FOUND; the migration keeps it that way.
	it("fails as a 500 when no row matches the id", async () => {
		const { expense } = harness();

		await expect(expense.update(INPUT)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update expense.",
		});
	});
});

describe("delete", () => {
	it("deletes by id and reports success", async () => {
		const { expense, queries } = harness();

		await expect(expense.delete({ id: 7 })).resolves.toEqual({
			success: true,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      7,
			    ],
			    "sql": "delete from "expense" where "expense"."id" = $1",
			  },
			]
		`);
	});
});

it("rejects a signed-out call before any query", async () => {
	const { expense, queries } = harness(undefined, null);

	await expect(expense.delete({ id: 7 })).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(queries).toEqual([]);
});
