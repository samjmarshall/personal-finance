import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
} from "~/server/db/recording-db.fake";
import { DrizzleIncomeRepository } from "./income.repository";
import { income } from "./income.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleIncomeRepository({ db: db as never }),
		queries,
	};
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

const INCOME_ROW = rowOf(COLUMNS, INCOME);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("DrizzleIncomeRepository", () => {
	it("list selects every income by person, sort order, then source", async () => {
		const { repository, queries } = harness(() => [INCOME_ROW]);

		await expect(repository.list()).resolves.toEqual([INCOME]);
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

	it("insert returns the stored row", async () => {
		const { repository, queries } = harness(() => [INCOME_ROW]);

		await expect(
			repository.insert({ person: "Alex", source: "Salary", fortnight: 3000 }),
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

	it("insert gives undefined when no row comes back", async () => {
		const { repository } = harness();

		await expect(
			repository.insert({ person: "Alex", source: "Salary" }),
		).resolves.toBeUndefined();
	});

	it("insert lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23502"));

		await expect(
			repository.insert({ person: "Alex", source: "Salary" }),
		).rejects.toMatchObject({ cause: { code: "23502" } });
	});

	it("update sets only the fields sent, so omitted amounts keep their stored value", async () => {
		const { repository, queries } = harness(() => [INCOME_ROW]);

		await expect(
			repository.update(4, {
				person: "Alex",
				source: "Salary",
				kind: CommitmentKind.Recurring,
			}),
		).resolves.toEqual(INCOME);
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

	it("update gives undefined when no row has the id", async () => {
		const { repository } = harness();

		await expect(
			repository.update(4, {
				person: "Alex",
				source: "Salary",
				kind: CommitmentKind.Recurring,
			}),
		).resolves.toBeUndefined();
	});

	it("delete deletes by id", async () => {
		const { repository, queries } = harness();

		await repository.delete(4);

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
