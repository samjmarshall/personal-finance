import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "~/domain/categories";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import {
	pgError,
	type Respond,
	recordingDb,
} from "~/server/db/recording-db.fake";
import { expenseCategories } from "~/server/expenses/categories.schema";
import { categoryRouter } from "./category";

// Characterizes the router before it moves to src/server/expenses/: the SQL it
// sends and the codes and messages it returns must survive the move unchanged.

const router = createTRPCRouter({ category: categoryRouter });

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
	return { category: caller.category, queries };
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-10-02T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(expenseCategories));

// Driver sends timestamps as text; drizzle parses them back into Dates.
function rowOf(fields: string[], fixture: Record<string, unknown>) {
	return fields.map((field) => {
		const value = fixture[field];
		return value instanceof Date ? value.toISOString() : (value ?? null);
	});
}

const CATEGORY = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Category;

const CATEGORY_ROW = rowOf(COLUMNS, CATEGORY);

const NAME_TAKEN = {
	code: "CONFLICT",
	message: "A category with that name already exists.",
	cause: expect.any(Error),
};

const isSelect = (sql: string) => sql.startsWith("select ");
const isCount = (sql: string) => sql.startsWith("select count(*)");
const isNextSortOrder = (sql: string) => sql.startsWith("select coalesce(max(");
const isCategoryUpdate = (sql: string) =>
	sql.startsWith('update "expense_category"');

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("list", () => {
	it("counts each category's expenses by name, ordered by sort order then name", async () => {
		// The driver sends count(*) as text; mapWith(Number) turns it into a number.
		const { category, queries } = harness(() => [[...CATEGORY_ROW, "2"]]);

		await expect(category.list()).resolves.toEqual([
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
});

describe("create", () => {
	it("trims the input and sorts the new category last", async () => {
		const { category, queries } = harness(({ sql }) =>
			isNextSortOrder(sql) ? [[4]] : [CATEGORY_ROW],
		);

		await expect(
			category.create({
				name: "  Food ",
				description: " Groceries and takeaway ",
			}),
		).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select coalesce(max("sortOrder") + 1, 0) from "expense_category"",
			  },
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

	it("stores a blank description as null", async () => {
		const { category, queries } = harness(({ sql }) =>
			isNextSortOrder(sql) ? [[4]] : [CATEGORY_ROW],
		);

		await category.create({ name: "Food", description: "   " });

		expect(queries[1]?.params).toMatchInlineSnapshot(`
			[
			  "Food",
			  null,
			  4,
			  "2026-10-02T00:00:00.000Z",
			  "2026-10-02T00:00:00.000Z",
			]
		`);
	});

	it("sorts first when there is no sort order row", async () => {
		const { category, queries } = harness(({ sql }) =>
			isNextSortOrder(sql) ? [] : [CATEGORY_ROW],
		);

		await category.create({ name: "Food" });

		expect(queries[1]?.params).toMatchInlineSnapshot(`
			[
			  "Food",
			  null,
			  0,
			  "2026-10-02T00:00:00.000Z",
			  "2026-10-02T00:00:00.000Z",
			]
		`);
	});

	it("turns a duplicate name into a conflict", async () => {
		const { category } = harness(({ sql }) =>
			isNextSortOrder(sql) ? [[4]] : pgError("23505"),
		);

		await expect(category.create({ name: "Food" })).rejects.toMatchObject(
			NAME_TAKEN,
		);
	});

	it("fails as a 500 when the insert returns no row", async () => {
		const { category } = harness(({ sql }) =>
			isNextSortOrder(sql) ? [[4]] : [],
		);

		await expect(category.create({ name: "Food" })).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create category.",
		});
	});
});

describe("update", () => {
	it("rejects a missing id after one select, before any transaction", async () => {
		const { category, queries } = harness();

		await expect(
			category.update({ id: 3, name: "Food" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Category not found.",
		});
		expect(queries.map(({ sql }) => sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			]
		`);
	});

	it("keeps the same name without touching expenses", async () => {
		const { category, queries } = harness(() => [CATEGORY_ROW]);

		await expect(
			category.update({
				id: 3,
				name: " Food ",
				description: "Groceries and takeaway",
			}),
		).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			    ],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			  },
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

	it("moves expenses to a new name in the same transaction", async () => {
		const renamed = { ...CATEGORY, name: "Groceries" };
		const { category, queries } = harness(({ sql }) =>
			isSelect(sql) ? [CATEGORY_ROW] : [rowOf(COLUMNS, renamed)],
		);

		await expect(
			category.update({ id: 3, name: "Groceries", description: "" }),
		).resolves.toEqual(renamed);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			    ],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			  },
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

	it("rolls back and turns a duplicate name into a conflict", async () => {
		const { category, queries } = harness(({ sql }) => {
			if (isSelect(sql)) return [CATEGORY_ROW];
			return isCategoryUpdate(sql) ? pgError("23505") : [];
		});

		await expect(
			category.update({ id: 3, name: "Groceries" }),
		).rejects.toMatchObject(NAME_TAKEN);
		expect(queries.map(({ sql }) => sql)).toMatchInlineSnapshot(`
			[
			  "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			  "begin",
			  "update "expense" set "category" = $1, "updatedAt" = $2 where "expense"."category" = $3",
			  "update "expense_category" set "name" = $1, "description" = $2, "updatedAt" = $3 where "expense_category"."id" = $4 returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  "rollback",
			]
		`);
	});

	it("fails as a 500 when the update returns no row", async () => {
		const { category } = harness(({ sql }) =>
			isSelect(sql) ? [CATEGORY_ROW] : [],
		);

		await expect(
			category.update({ id: 3, name: "Food" }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to update category.",
		});
	});
});

describe("reorder", () => {
	it("sets each id's sort order to its position in one transaction", async () => {
		const { category, queries } = harness();

		await expect(category.reorder({ ids: [3, 1, 2] })).resolves.toEqual({
			success: true,
		});
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
});

describe("delete", () => {
	function deleting(count: string) {
		return harness(({ sql }) => {
			if (isCount(sql)) return [[count]];
			return isSelect(sql) ? [CATEGORY_ROW] : [];
		});
	}

	it("rejects a missing id", async () => {
		const { category, queries } = harness();

		await expect(category.delete({ id: 3 })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Category not found.",
		});
		expect(queries).toHaveLength(1);
	});

	// "1 expense still use it." is today's grammar, pinned as is.
	it("refuses while one expense still uses the name", async () => {
		const { category, queries } = deleting("1");

		await expect(category.delete({ id: 3 })).rejects.toMatchObject({
			code: "CONFLICT",
			message: 'Cannot delete "Food" — 1 expense still use it.',
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			    ],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "expense_category" where "expense_category"."id" = $1",
			  },
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

	it("pluralises the count", async () => {
		const { category } = deleting("2");

		await expect(category.delete({ id: 3 })).rejects.toMatchObject({
			code: "CONFLICT",
			message: 'Cannot delete "Food" — 2 expenses still use it.',
		});
	});

	it("deletes by id once no expense uses it", async () => {
		const { category, queries } = deleting("0");

		await expect(category.delete({ id: 3 })).resolves.toEqual({
			success: true,
		});
		expect(queries[2]).toMatchInlineSnapshot(`
			{
			  "method": "execute",
			  "params": [
			    3,
			  ],
			  "sql": "delete from "expense_category" where "expense_category"."id" = $1",
			}
		`);
	});
});

it("rejects a signed-out call before any query", async () => {
	const { category, queries } = harness(undefined, null);

	await expect(category.delete({ id: 3 })).rejects.toMatchObject({
		code: "UNAUTHORIZED",
	});
	expect(queries).toEqual([]);
});
