import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { type Respond, recordingDb } from "~/server/db/recording-db.fake";
import { income } from "~/server/income/income.schema";
import { incomeRouter } from "./income";

// Characterizes the router before it moves to src/server/income/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ income: incomeRouter });

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
	return { income: caller.income, queries };
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-10-06T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(income));

// Driver sends timestamps as text; drizzle parses them back into Dates.
function rowOf(fields: string[], fixture: Record<string, unknown>) {
	return fields.map((field) => {
		const value = fixture[field];
		return value instanceof Date ? value.toISOString() : (value ?? null);
	});
}

const INCOME = {
	id: 4,
	person: "Alex",
	source: "Salary",
	kind: CommitmentKind.Recurring,
	fortnight: 3000,
	month: 6500,
	year: 78000,
	amount: null,
	expectedDate: null,
	dueDay: null,
	dueMonth: null,
	sortOrder: 0,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Income;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("list", () => {
	it("selects every income by person, sort order, then source", async () => {
		const { income, queries } = harness(() => [rowOf(COLUMNS, INCOME)]);

		await expect(income.list()).resolves.toEqual([INCOME]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "person", "source", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt" from "income" order by "income"."person" asc, "income"."sortOrder" asc, "income"."source" asc",
			  },
			]
		`);
	});
});

describe("create", () => {
	it("inserts the parsed input and returns the stored row", async () => {
		const { income, queries } = harness(() => [rowOf(COLUMNS, INCOME)]);

		await expect(
			income.create({ person: "Alex", source: "Salary", fortnight: 3000 }),
		).resolves.toEqual(INCOME);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Alex",
			      "Salary",
			      3000,
			      "2026-10-06T00:00:00.000Z",
			      "2026-10-06T00:00:00.000Z",
			    ],
			    "sql": "insert into "income" ("id", "person", "source", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt") values (default, $1, $2, default, $3, default, default, default, default, default, default, default, $4, $5) returning "id", "person", "source", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("fails as a 500 when the insert returns no row", async () => {
		const { income } = harness();

		await expect(
			income.create({ person: "Alex", source: "Salary" }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create income.",
		});
	});
});

describe("update", () => {
	const INPUT = {
		id: 4,
		person: "Alex",
		source: "Salary",
		kind: CommitmentKind.Recurring,
	};

	it("sets only the fields sent, so omitted amounts keep their stored value", async () => {
		const { income, queries } = harness(() => [rowOf(COLUMNS, INCOME)]);

		await expect(income.update(INPUT)).resolves.toEqual(INCOME);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Alex",
			      "Salary",
			      "recurring",
			      "2026-10-06T00:00:00.000Z",
			      4,
			    ],
			    "sql": "update "income" set "person" = $1, "source" = $2, "kind" = $3, "updatedAt" = $4 where "income"."id" = $5 returning "id", "person", "source", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	// A missing id is a 500, not NOT_FOUND; the migration keeps it that way.
	it("fails as a 500 when no row matches the id", async () => {
		const { income } = harness();

		await expect(income.update(INPUT)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update income.",
		});
	});
});

describe("delete", () => {
	// Reports success even when no row had the id; the migration keeps that too.
	it("deletes by id and reports success", async () => {
		const { income, queries } = harness();

		await expect(income.delete({ id: 4 })).resolves.toEqual({
			success: true,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      4,
			    ],
			    "sql": "delete from "income" where "income"."id" = $1",
			  },
			]
		`);
	});
});

it("rejects a signed-out call before any query", async () => {
	const { income, queries } = harness(undefined, null);

	await expect(income.list()).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(queries).toEqual([]);
});
