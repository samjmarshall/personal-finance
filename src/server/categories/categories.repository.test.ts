import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "~/domain/categories";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleCategoriesRepository } from "./categories.repository";
import { categories } from "./categories.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleCategoriesRepository({ db: db as never }),
		queries,
	};
}

// Fixed clock, so the auto-set created/updated times are predictable.
const NOW = new Date("2026-10-02T00:00:00.000Z");

const CATEGORY_COLUMNS = Object.keys(getTableColumns(categories));

const CATEGORY = {
	id: 3,
	name: "Food",
	description: "Groceries and takeaway",
	sortOrder: 1,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Category;

const CATEGORY_ROW = rowOf(CATEGORY_COLUMNS, CATEGORY);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("categories", () => {
	it("list selects every category by sort order then name, with no join", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(repository.list()).resolves.toEqual([CATEGORY]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "category" order by "category"."sortOrder" asc, "category"."name" asc",
			  },
			]
		`);
	});

	it("nextSortOrder is one past the highest sort order", async () => {
		const { repository, queries } = harness(() => [[4]]);

		await expect(repository.nextSortOrder()).resolves.toBe(4);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select coalesce(max("sortOrder") + 1, 0) from "category"",
			  },
			]
		`);
	});

	it("nextSortOrder is 0 when there is no sort order row", async () => {
		const { repository } = harness();

		await expect(repository.nextSortOrder()).resolves.toBe(0);
	});

	it("insert returns the stored row", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(
			repository.insert({
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
			    "sql": "insert into "category" ("id", "name", "description", "sortOrder", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, $5) returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("insert lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23505"));

		await expect(
			repository.insert({
				name: "Food",
				description: null,
				sortOrder: 4,
			}),
		).rejects.toMatchObject({ cause: { code: "23505" } });
	});

	it("find selects by id", async () => {
		const { repository, queries } = harness(() => [CATEGORY_ROW]);

		await expect(repository.find(3)).resolves.toEqual(CATEGORY);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			    ],
			    "sql": "select "id", "name", "description", "sortOrder", "createdAt", "updatedAt" from "category" where "category"."id" = $1",
			  },
			]
		`);
	});

	it("find gives undefined when no row has the id", async () => {
		const { repository } = harness();

		await expect(repository.find(3)).resolves.toBeUndefined();
	});

	it("update renames in one statement, never touching expenses", async () => {
		const renamed = { ...CATEGORY, name: "Groceries", description: null };
		const { repository, queries } = harness(() => [
			rowOf(CATEGORY_COLUMNS, renamed),
		]);

		await expect(
			repository.update(3, { name: "Groceries", description: null }),
		).resolves.toEqual(renamed);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "Groceries",
			      null,
			      "2026-10-02T00:00:00.000Z",
			      3,
			    ],
			    "sql": "update "category" set "name" = $1, "description" = $2, "updatedAt" = $3 where "category"."id" = $4 returning "id", "name", "description", "sortOrder", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("update lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23505"));

		await expect(
			repository.update(3, { name: "Groceries", description: null }),
		).rejects.toMatchObject({ cause: { code: "23505" } });
	});

	it("update gives undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(
			repository.update(3, { name: "Food", description: null }),
		).resolves.toBeUndefined();
	});

	it("reorder sets each id's sort order to its position in one transaction", async () => {
		const { repository, queries } = harness();

		await repository.reorder([3, 1, 2]);

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
			    "sql": "update "category" set "sortOrder" = $1, "updatedAt" = $2 where "category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [
			      1,
			      "2026-10-02T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "category" set "sortOrder" = $1, "updatedAt" = $2 where "category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [
			      2,
			      "2026-10-02T00:00:00.000Z",
			      2,
			    ],
			    "sql": "update "category" set "sortOrder" = $1, "updatedAt" = $2 where "category"."id" = $3",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("delete deletes by id", async () => {
		const { repository, queries } = harness();

		await repository.delete(3);

		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      3,
			    ],
			    "sql": "delete from "category" where "category"."id" = $1",
			  },
			]
		`);
	});

	it("delete lets an in-use (23503) error bubble", async () => {
		const { repository } = harness(() => pgError("23503"));

		await expect(repository.delete(3)).rejects.toMatchObject({
			cause: { code: "23503" },
		});
	});

	it("findNames selects the id and name of each category id", async () => {
		const { repository, queries } = harness(() => [[3, "Food"]]);

		await expect(repository.findNames([3, 4])).resolves.toEqual([
			{ id: 3, name: "Food" },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      3,
			      4,
			    ],
			    "sql": "select "id", "name" from "category" where "category"."id" in ($1, $2)",
			  },
			]
		`);
	});
});
