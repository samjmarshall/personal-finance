import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "~/domain/categories";
import type { Expense } from "~/domain/expenses";
import { CommitmentKind } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
} from "~/server/db/recording-db.fake";
import { expenseCategories } from "./categories.schema";
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
const CATEGORY_COLUMNS = Object.keys(getTableColumns(expenseCategories));

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

const CATEGORY = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Category;

const EXPENSE_ROW = rowOf(EXPENSE_COLUMNS, EXPENSE);
const CATEGORY_ROW = rowOf(CATEGORY_COLUMNS, CATEGORY);

const isExpenseUpdate = (sql: string) => sql.startsWith('update "expense" ');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("expenses", () => {
	it("list selects every expense by category, sort order, then name", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(repository.list()).resolves.toEqual([EXPENSE]);
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

	it("insert returns the stored row", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(
			repository.insert({
				name: "Weekly shop",
				category: "Food",
				fortnight: 200,
			}),
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

	it("insert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.insert({ name: "Weekly shop", category: "Food" }),
		).resolves.toBeUndefined();
	});

	it("update sets only the fields sent", async () => {
		const { repository, queries } = harness(() => [EXPENSE_ROW]);

		await expect(
			repository.update(7, {
				name: "Weekly shop",
				category: "Food",
				kind: CommitmentKind.Recurring,
			}),
		).resolves.toEqual(EXPENSE);
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

	it("update gives undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(
			repository.update(7, {
				name: "Weekly shop",
				category: "Food",
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

describe("categories", () => {
	it("listCategories counts each category's expenses by name, ordered by sort order then name", async () => {
		// The driver sends count(*) as text; mapWith(Number) turns it into a number.
		const { repository, queries } = harness(() => [[...CATEGORY_ROW, "2"]]);

		await expect(repository.listCategories()).resolves.toEqual([
			{ ...CATEGORY, expenseCount: 2 },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "expense_category"."id", "expense_category"."name", "expense_category"."description", "expense_category"."sortOrder", "expense_category"."createdAt", "expense_category"."updatedAt", count("expense"."id") from "expense_category" left join "expense" on "expense"."category" = "expense_category"."name" group by "expense_category"."id" order by "expense_category"."sortOrder" asc, "expense_category"."name" asc",
			  },
			]
		`);
	});

	it("nextCategorySortOrder is one past the highest sort order", async () => {
		const { repository, queries } = harness(() => [[4]]);

		await expect(repository.nextCategorySortOrder()).resolves.toBe(4);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select coalesce(max("sortOrder") + 1, 0) from "expense_category"",
			  },
			]
		`);
	});

	it("nextCategorySortOrder is 0 when there is no sort order row", async () => {
		const { repository } = harness();

		await expect(repository.nextCategorySortOrder()).resolves.toBe(0);
	});

	it("insertCategory returns the stored row", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(
			repository.insertCategory({
				name: "Food",
				description: "Groceries and takeaway",
				sortOrder: 4,
			}),
		).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Food",
			      "Groceries and takeaway",
			      4,
			      "2026-10-02T00:00:00.000Z",
			      "2026-10-02T00:00:00.000Z",
			    ],
			    "sql": "insert into "expense_category" ("id", "name", "description", "sortOrder", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, $5) returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("insertCategory lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23505"));

		await expect(
			repository.insertCategory({
				name: "Food",
				description: null,
				sortOrder: 4,
			}),
		).rejects.toMatchObject({ cause: { code: "23505" } });
	});

	it("findCategory selects by id", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(repository.findCategory(3)).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			    ],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			  },
			]
		`);
	});

	it("findCategory gives undefined when no row has the id", async () => {
		const { repository } = harness();

		await expect(repository.findCategory(3)).resolves.toBeUndefined();
	});

	it("updateCategory keeps the same name without touching expenses", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(
			repository.updateCategory(
				3,
				{ name: "Food", description: "Groceries and takeaway" },
				"Food",
			),
		).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "begin",
			  },
			  {
			    "method": "all",
			    "params": [
			      "Food",
			      "Groceries and takeaway",
			      "2026-10-02T00:00:00.000Z",
			      3,
			    ],
			    "sql": "update "expense_category" set "name" = $1, "description" = $2, "updatedAt" = $3 where "expense_category"."id" = $4 returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("updateCategory moves expenses to a new name in the same transaction", async () => {
		const renamed = { ...CATEGORY, name: "Groceries", description: null };
		const { repository, queries } = harness(({ sql }) =>
			isExpenseUpdate(sql) ? [] : [rowOf(CATEGORY_COLUMNS, renamed)],
		);

		await expect(
			repository.updateCategory(
				3,
				{ name: "Groceries", description: null },
				"Food",
			),
		).resolves.toEqual(renamed);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "begin",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "Groceries",
			      "2026-10-02T00:00:00.000Z",
			      "Food",
			    ],
			    "sql": "update "expense" set "category" = $1, "updatedAt" = $2 where "expense"."category" = $3",
			  },
			  {
			    "method": "all",
			    "params": [
			      "Groceries",
			      null,
			      "2026-10-02T00:00:00.000Z",
			      3,
			    ],
			    "sql": "update "expense_category" set "name" = $1, "description" = $2, "updatedAt" = $3 where "expense_category"."id" = $4 returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("updateCategory rolls back and lets a driver error bubble", async () => {
		const { repository, queries } = harness(({ sql }) =>
			isExpenseUpdate(sql) ? [] : pgError("23505"),
		);

		await expect(
			repository.updateCategory(
				3,
				{ name: "Groceries", description: null },
				"Food",
			),
		).rejects.toMatchObject({ cause: { code: "23505" } });
		expect(queries.map(({ sql }) => sql)).toMatchInlineSnapshot(`
			[
			  "begin",
			  "update "expense" set "category" = $1, "updatedAt" = $2 where "expense"."category" = $3",
			  "update "expense_category" set "name" = $1, "description" = $2, "updatedAt" = $3 where "expense_category"."id" = $4 returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  "rollback",
			]
		`);
	});

	it("updateCategory gives undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(
			repository.updateCategory(3, { name: "Food", description: null }, "Food"),
		).resolves.toBeUndefined();
	});

	it("reorderCategories sets each id's sort order to its position in one transaction", async () => {
		const { repository, queries } = harness();

		await repository.reorderCategories([3, 1, 2]);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "begin",
			  },
			  {
			    "method": "execute",
			    "params": [
			      0,
			      "2026-10-02T00:00:00.000Z",
			      3,
			    ],
			    "sql": "update "expense_category" set "sortOrder" = $1, "updatedAt" = $2 where "expense_category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [
			      1,
			      "2026-10-02T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "expense_category" set "sortOrder" = $1, "updatedAt" = $2 where "expense_category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [
			      2,
			      "2026-10-02T00:00:00.000Z",
			      2,
			    ],
			    "sql": "update "expense_category" set "sortOrder" = $1, "updatedAt" = $2 where "expense_category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("countExpensesInCategory counts expenses filed under the name", async () => {
		// The driver sends count(*) as text; mapWith(Number) turns it into a number.
		const { repository, queries } = harness(() => [["2"]]);

		await expect(repository.countExpensesInCategory("Food")).resolves.toBe(2);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Food",
			    ],
			    "sql": "select count(*) from "expense" where "expense"."category" = $1",
			  },
			]
		`);
	});

	it("countExpensesInCategory is 0 when the count row is missing", async () => {
		const { repository } = harness();

		await expect(repository.countExpensesInCategory("Food")).resolves.toBe(0);
	});

	it("deleteCategory deletes by id", async () => {
		const { repository, queries } = harness();

		await repository.deleteCategory(3);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      3,
			    ],
			    "sql": "delete from "expense_category" where "expense_category"."id" = $1",
			  },
			]
		`);
	});
});
