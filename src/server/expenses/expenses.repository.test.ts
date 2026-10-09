import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "~/domain/expenses";
import { CommitmentKind } from "~/lib/constants";
import {
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleExpensesRepository } from "./expenses.repository";
import { expenses } from "./expenses.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleExpensesRepository({ db: db as never }),
		queries,
	};
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-10-02T00:00:00.000Z");

const EXPENSE_COLUMNS = Object.keys(getTableColumns(expenses));

const EXPENSE = {
	id: 7,
	name: "Weekly shop",
	categoryId: 3,
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

const EXPENSE_ROW = rowOf(EXPENSE_COLUMNS, EXPENSE);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("expenses", () => {
	it("list selects every expense by category id, sort order, then name", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(repository.list()).resolves.toEqual([EXPENSE]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "name", "categoryId", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt" from "expense" order by "expense"."categoryId" asc, "expense"."sortOrder" asc, "expense"."name" asc",
			  },
			]
		`);
	});

	it("insert returns the stored row", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(
			repository.insert({
				name: "Weekly shop",
				categoryId: 3,
				fortnight: 200,
			}),
		).resolves.toEqual(EXPENSE);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Weekly shop",
			      3,
			      200,
			      "2026-10-02T00:00:00.000Z",
			      "2026-10-02T00:00:00.000Z",
			    ],
			    "sql": "insert into "expense" ("id", "name", "categoryId", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt") values (default, $1, $2, default, $3, default, default, default, default, default, default, default, $4, $5) returning "id", "name", "categoryId", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("insert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.insert({ name: "Weekly shop", categoryId: 3 }),
		).resolves.toBeUndefined();
	});

	it("update sets only the fields sent", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(
			repository.update(7, {
				name: "Weekly shop",
				categoryId: 3,
				kind: CommitmentKind.Recurring,
			}),
		).resolves.toEqual(EXPENSE);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Weekly shop",
			      3,
			      "recurring",
			      "2026-10-02T00:00:00.000Z",
			      7,
			    ],
			    "sql": "update "expense" set "name" = $1, "categoryId" = $2, "kind" = $3, "updatedAt" = $4 where "expense"."id" = $5 returning "id", "name", "categoryId", "kind", "fortnight", "month", "year", "amount", "expectedDate", "dueDay", "dueMonth", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("update gives undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(
			repository.update(7, {
				name: "Weekly shop",
				categoryId: 3,
				kind: CommitmentKind.Recurring,
			}),
		).resolves.toBeUndefined();
	});

	it("delete deletes by id", async () => {
		const { repository, queries } = harness();

		await repository.delete(7);

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

describe("lookups", () => {
	it("findNames selects the id, name and categoryId of each expense id", async () => {
		const { repository, queries } = harness(() => [[7, "Weekly shop", 3]]);

		await expect(repository.findNames([7, 8])).resolves.toEqual([
			{ id: 7, name: "Weekly shop", categoryId: 3 },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      8,
			    ],
			    "sql": "select "id", "name", "categoryId" from "expense" where "expense"."id" in ($1, $2)",
			  },
			]
		`);
	});

	it("countsByCategory counts expenses per category id", async () => {
		// The driver sends count() as text; the repository must return a number.
		const { repository, queries } = harness(() => [[3, "2"]]);

		await expect(repository.countsByCategory()).resolves.toEqual([
			{ categoryId: 3, count: 2 },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "categoryId", count("id") from "expense" group by "expense"."categoryId"",
			  },
			]
		`);
	});
});
