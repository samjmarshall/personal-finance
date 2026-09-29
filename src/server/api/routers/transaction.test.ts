import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "~/domain/transactions";
import { Frequency, Priority } from "~/lib/constants";
import { pgError, recordingDb } from "~/server/db/recording-db.fake";
import { transactions } from "~/server/transactions/transactions.schema";

// Characterization: pins today's SQL, codes and messages so the 3-tier move
// can prove it changed nothing the member sees.

// Importing the router pulls in ~/server/api/trpc, which loads the real db + auth
// (and through them ~/env). Stub those so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

const { createCallerFactory, createTRPCRouter } = await import(
	"~/server/api/trpc"
);
const { transactionRouter } = await import("./transaction");
const { expenseRouter } = await import("./expense");

const router = createTRPCRouter({
	transaction: transactionRouter,
	expense: expenseRouter,
});

function caller(db: unknown, session: unknown = { user: { id: "member-1" } }) {
	return createCallerFactory(router)({
		db,
		session,
		headers: new Headers(),
	} as never);
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-09-29T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(transactions));
const LIST_FIELDS = [...COLUMNS, "expenseName", "expenseCategoryName"];

// Driver sends timestamps as text; drizzle parses them back into Dates.
function rowOf(fields: string[], fixture: Record<string, unknown>) {
	return fields.map((field) => {
		const value = fixture[field];
		return value instanceof Date ? value.toISOString() : (value ?? null);
	});
}

const TRANSACTION = {
	id: 1,
	expenseId: 7,
	expenseCategoryId: 3,
	date: new Date("2026-09-01T00:00:00.000Z"),
	description: "Groceries",
	receiptDescription: null,
	amount: 42.5,
	category: "Food",
	frequency: Frequency.OneOff,
	priority: Priority.MustHave,
	notes: null,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Transaction;

const FIELDS = {
	date: TRANSACTION.date,
	description: TRANSACTION.description,
	amount: TRANSACTION.amount,
	category: TRANSACTION.category,
	frequency: TRANSACTION.frequency,
	priority: TRANSACTION.priority,
	notes: null,
	expenseId: TRANSACTION.expenseId,
	expenseCategoryId: TRANSACTION.expenseCategoryId,
};

// The pg error sits under a few wrappers; how many is not behaviour, and the
// 3-tier move adds one.
function rootCause(error: unknown): unknown {
	let current = error;
	while (current instanceof Error && current.cause !== undefined) {
		current = current.cause;
	}
	return current;
}

const isCount = (sql: string) => sql.startsWith("select cast(count(*)");
// The select list and joins are pinned once by the default case; filter and
// sort cases pin only the tail they change.
const fromWhere = (sql: string) => sql.slice(sql.indexOf(" where "));
const fromOrderBy = (sql: string) => sql.slice(sql.indexOf(" order by "));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("transaction.list", () => {
	it("pages newest first over two left joins and totals from the count row", async () => {
		const item = {
			...TRANSACTION,
			expenseName: "Weekly shop",
			expenseCategoryName: "Groceries",
		};
		const { db, queries } = recordingDb(({ sql }) =>
			isCount(sql) ? [[3]] : [rowOf(LIST_FIELDS, item)],
		);

		const result = await caller(db).transaction.list({});

		expect(result).toEqual({ items: [item], total: 3 });
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      50,
			    ],
			    "sql": "select "transaction"."id", "transaction"."expenseId", "transaction"."expenseCategoryId", "transaction"."date", "transaction"."description", "transaction"."receiptDescription", "transaction"."amount", "transaction"."category", "transaction"."frequency", "transaction"."priority", "transaction"."notes", "transaction"."createdAt", "transaction"."updatedAt", "expense"."name", "expense_category"."name" from "transaction" left join "expense" on "transaction"."expenseId" = "expense"."id" left join "expense_category" on "transaction"."expenseCategoryId" = "expense_category"."id" order by "transaction"."date" desc, "transaction"."id" desc limit $1",
			  },
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select cast(count(*) as int) from "transaction"",
			  },
			]
		`);
	});

	it("reports a zero total when the count row is missing", async () => {
		const { db } = recordingDb();

		await expect(caller(db).transaction.list({})).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	// drizzle drops a zero offset, so the default case above renders no offset.
	it("pages with the given limit and offset", async () => {
		const { db, queries } = recordingDb();

		await caller(db).transaction.list({ limit: 20, offset: 40 });

		const page = queries.find(({ sql }) => !isCount(sql));
		expect({
			sql: fromOrderBy(page?.sql ?? ""),
			params: page?.params,
		}).toMatchInlineSnapshot(`
			{
			  "params": [
			    20,
			    40,
			  ],
			  "sql": " order by "transaction"."date" desc, "transaction"."id" desc limit $1 offset $2",
			}
		`);
	});

	it("each filter narrows both the page and the count", async () => {
		const filters = {
			search: { search: "cafe" },
			priority: { priority: Priority.MustHave },
			frequency: { frequency: Frequency.Recurring },
			category: { category: "Food" },
			from: { from: new Date("2026-09-01T00:00:00.000Z") },
			to: { to: new Date("2026-09-30T00:00:00.000Z") },
		};
		const rendered: Record<string, unknown> = {};

		for (const [name, filter] of Object.entries(filters)) {
			const { db, queries } = recordingDb();
			await caller(db).transaction.list(filter);
			rendered[name] = queries.map(({ sql, params }) => ({
				sql: fromWhere(sql),
				params,
			}));
		}

		expect(rendered).toMatchInlineSnapshot(`
			{
			  "category": [
			    {
			      "params": [
			        "Food",
			        50,
			      ],
			      "sql": " where "transaction"."category" = $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "Food",
			      ],
			      "sql": " where "transaction"."category" = $1",
			    },
			  ],
			  "frequency": [
			    {
			      "params": [
			        "Recurring",
			        50,
			      ],
			      "sql": " where "transaction"."frequency" = $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "Recurring",
			      ],
			      "sql": " where "transaction"."frequency" = $1",
			    },
			  ],
			  "from": [
			    {
			      "params": [
			        "2026-09-01T00:00:00.000Z",
			        50,
			      ],
			      "sql": " where "transaction"."date" >= $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "2026-09-01T00:00:00.000Z",
			      ],
			      "sql": " where "transaction"."date" >= $1",
			    },
			  ],
			  "priority": [
			    {
			      "params": [
			        "Must Have",
			        50,
			      ],
			      "sql": " where "transaction"."priority" = $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "Must Have",
			      ],
			      "sql": " where "transaction"."priority" = $1",
			    },
			  ],
			  "search": [
			    {
			      "params": [
			        "%cafe%",
			        "%cafe%",
			        "%cafe%",
			        50,
			      ],
			      "sql": " where ("transaction"."description" ilike $1 or "transaction"."category" ilike $2 or "transaction"."notes" ilike $3) order by "transaction"."date" desc, "transaction"."id" desc limit $4",
			    },
			    {
			      "params": [
			        "%cafe%",
			        "%cafe%",
			        "%cafe%",
			      ],
			      "sql": " where ("transaction"."description" ilike $1 or "transaction"."category" ilike $2 or "transaction"."notes" ilike $3)",
			    },
			  ],
			  "to": [
			    {
			      "params": [
			        "2026-09-30T00:00:00.000Z",
			        50,
			      ],
			      "sql": " where "transaction"."date" <= $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "2026-09-30T00:00:00.000Z",
			      ],
			      "sql": " where "transaction"."date" <= $1",
			    },
			  ],
			}
		`);
	});

	it("each sortBy key orders the page, with id desc as the tiebreaker", async () => {
		const sortKeys = [
			"date",
			"description",
			"amount",
			"category",
			"priority",
		] as const;
		const rendered: Record<string, string> = {};

		for (const sortBy of sortKeys) {
			const { db, queries } = recordingDb();
			await caller(db).transaction.list({ sortBy, sortDir: "asc" });
			const page = queries.find(({ sql }) => !isCount(sql));
			rendered[sortBy] = fromOrderBy(page?.sql ?? "");
		}

		expect(rendered).toMatchInlineSnapshot(`
			{
			  "amount": " order by "transaction"."amount" asc, "transaction"."id" desc limit $1",
			  "category": " order by "transaction"."category" asc, "transaction"."id" desc limit $1",
			  "date": " order by "transaction"."date" asc, "transaction"."id" desc limit $1",
			  "description": " order by "transaction"."description" asc, "transaction"."id" desc limit $1",
			  "priority": " order by "transaction"."priority" asc, "transaction"."id" desc limit $1",
			}
		`);
	});
});

describe("transaction.summary", () => {
	// Matched by SQL text, so a swapped Promise.all slot would put a staged row
	// under the wrong key.
	function summaryRows(sql: string): unknown[][] {
		if (sql.includes(" limit ")) return [["Food", 80, 2]];
		if (sql.includes("date_trunc")) return [["2026-09", 80]];
		if (sql.includes("priority")) return [[Priority.MustHave, 60, 1]];
		if (sql.includes("frequency")) return [[Frequency.OneOff, 60, 1]];
		return [[80, -20, 60, 3]];
	}

	it("runs the five aggregates and maps each into its slot", async () => {
		const { db, queries } = recordingDb(({ sql }) => summaryRows(sql));

		const result = await caller(db).transaction.summary();

		expect(result).toEqual({
			totals: { spend: 80, refunds: -20, net: 60, count: 3 },
			byPriority: [{ priority: Priority.MustHave, total: 60, count: 1 }],
			byFrequency: [{ frequency: Frequency.OneOff, total: 60, count: 1 }],
			byMonth: [{ month: "2026-09", total: 80 }],
			topCategories: [{ category: "Food", total: 80, count: 2 }],
		});
		expect(
			queries.map(({ sql, params }) => ({ sql, params })),
		).toMatchInlineSnapshot(`
			[
			  {
			    "params": [],
			    "sql": "select coalesce(sum(case when "amount" > 0 then "amount" else 0 end), 0), coalesce(sum(case when "amount" < 0 then "amount" else 0 end), 0), coalesce(sum("amount"), 0), cast(count(*) as int) from "transaction"",
			  },
			  {
			    "params": [],
			    "sql": "select "priority", coalesce(sum("amount"), 0), cast(count(*) as int) from "transaction" group by "transaction"."priority"",
			  },
			  {
			    "params": [],
			    "sql": "select "frequency", coalesce(sum("amount"), 0), cast(count(*) as int) from "transaction" group by "transaction"."frequency"",
			  },
			  {
			    "params": [],
			    "sql": "select to_char(date_trunc('month', "date"), 'YYYY-MM'), coalesce(sum(case when "amount" > 0 then "amount" else 0 end), 0) from "transaction" group by date_trunc('month', "transaction"."date") order by date_trunc('month', "transaction"."date")",
			  },
			  {
			    "params": [
			      8,
			    ],
			    "sql": "select "category", coalesce(sum(case when "amount" > 0 then "amount" else 0 end), 0), cast(count(*) as int) from "transaction" group by "transaction"."category" order by sum(case when "transaction"."amount" > 0 then "transaction"."amount" else 0 end) desc limit $1",
			  },
			]
		`);
	});

	it("reports zero totals when the totals row is missing", async () => {
		const { db } = recordingDb();

		await expect(caller(db).transaction.summary()).resolves.toEqual({
			totals: { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority: [],
			byFrequency: [],
			byMonth: [],
			topCategories: [],
		});
	});
});

describe("transaction.create", () => {
	it("inserts the fields and returns the stored row", async () => {
		const { db, queries } = recordingDb(() => [rowOf(COLUMNS, TRANSACTION)]);

		const row = await caller(db).transaction.create(FIELDS);

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      3,
			      "2026-09-01T00:00:00.000Z",
			      "Groceries",
			      42.5,
			      "Food",
			      "One-off",
			      "Must Have",
			      null,
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "expenseCategoryId", "date", "description", "receiptDescription", "amount", "category", "frequency", "priority", "notes", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, default, $5, $6, $7, $8, $9, $10, $11) returning "id", "expenseId", "expenseCategoryId", "date", "description", "receiptDescription", "amount", "category", "frequency", "priority", "notes", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("maps a foreign-key violation (23503) to CONFLICT", async () => {
		const { db } = recordingDb(() => pgError("23503"));

		const error = await caller(db)
			.transaction.create(FIELDS)
			.catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: "CONFLICT",
			message: "The selected expense or category no longer exists.",
		});
		expect(rootCause(error)).toMatchObject({ code: "23503" });
	});

	it("leaves any other violation (23505) as INTERNAL_SERVER_ERROR", async () => {
		const { db } = recordingDb(() => pgError("23505"));

		await expect(caller(db).transaction.create(FIELDS)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
	});

	it("raises INTERNAL_SERVER_ERROR when the insert returns no row", async () => {
		const { db } = recordingDb();

		await expect(caller(db).transaction.create(FIELDS)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create transaction.",
		});
	});
});

describe("transaction.update", () => {
	const input = { id: 1, ...FIELDS };

	it("updates the row by id and returns it", async () => {
		const { db, queries } = recordingDb(() => [rowOf(COLUMNS, TRANSACTION)]);

		const row = await caller(db).transaction.update(input);

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      3,
			      "2026-09-01T00:00:00.000Z",
			      "Groceries",
			      42.5,
			      "Food",
			      "One-off",
			      "Must Have",
			      null,
			      "2026-09-29T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "transaction" set "expenseId" = $1, "expenseCategoryId" = $2, "date" = $3, "description" = $4, "amount" = $5, "category" = $6, "frequency" = $7, "priority" = $8, "notes" = $9, "updatedAt" = $10 where "transaction"."id" = $11 returning "id", "expenseId", "expenseCategoryId", "date", "description", "receiptDescription", "amount", "category", "frequency", "priority", "notes", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("raises NOT_FOUND when no row matches the id", async () => {
		const { db } = recordingDb();

		await expect(caller(db).transaction.update(input)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Transaction not found.",
		});
	});

	it("maps a foreign-key violation (23503) to CONFLICT", async () => {
		const { db } = recordingDb(() => pgError("23503"));

		const error = await caller(db)
			.transaction.update(input)
			.catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: "CONFLICT",
			message: "The selected expense or category no longer exists.",
		});
		expect(rootCause(error)).toMatchObject({ code: "23503" });
	});
});

describe("transaction.unplanned", () => {
	it("selects unlinked Spend in the half-open window, by Group then newest", async () => {
		const { db, queries } = recordingDb(() => [rowOf(COLUMNS, TRANSACTION)]);

		const rows = await caller(db).transaction.unplanned({
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-15T00:00:00.000Z"),
		});

		expect(rows).toEqual([TRANSACTION]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      0,
			      "2026-09-01T00:00:00.000Z",
			      "2026-09-15T00:00:00.000Z",
			    ],
			    "sql": "select "id", "expenseId", "expenseCategoryId", "date", "description", "receiptDescription", "amount", "category", "frequency", "priority", "notes", "createdAt", "updatedAt" from "transaction" where ("transaction"."amount" > $1 and "transaction"."expenseId" is null and "transaction"."date" >= $2 and "transaction"."date" < $3) order by "transaction"."category" asc, "transaction"."date" desc, "transaction"."id" desc",
			  },
			]
		`);
	});

	it("rejects an inverted window before any query", async () => {
		const { db, queries } = recordingDb();

		await expect(
			caller(db).transaction.unplanned({
				from: new Date("2026-09-15T00:00:00.000Z"),
				to: new Date("2026-09-01T00:00:00.000Z"),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(queries).toHaveLength(0);
	});
});

describe("transaction.linkExpense", () => {
	const input = { id: 1, expenseId: 7 };

	it("writes only the expense link, plus the updatedAt stamp", async () => {
		const { db, queries } = recordingDb(() => [rowOf(COLUMNS, TRANSACTION)]);

		const row = await caller(db).transaction.linkExpense(input);

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      "2026-09-29T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "transaction" set "expenseId" = $1, "updatedAt" = $2 where "transaction"."id" = $3 returning "id", "expenseId", "expenseCategoryId", "date", "description", "receiptDescription", "amount", "category", "frequency", "priority", "notes", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("maps a foreign-key violation (23503) to CONFLICT naming only the expense", async () => {
		const { db } = recordingDb(() => pgError("23503"));

		const error = await caller(db)
			.transaction.linkExpense(input)
			.catch((e: unknown) => e);

		expect(error).toMatchObject({
			code: "CONFLICT",
			message: "The selected expense no longer exists.",
		});
		expect(rootCause(error)).toMatchObject({ code: "23503" });
	});

	it("raises NOT_FOUND when no row matches the id", async () => {
		const { db } = recordingDb();

		await expect(
			caller(db).transaction.linkExpense(input),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Transaction not found.",
		});
	});
});

describe("transaction.delete", () => {
	it("deletes by id and reports success", async () => {
		const { db, queries } = recordingDb();

		const result = await caller(db).transaction.delete({ id: 1 });

		expect(result).toEqual({ success: true });
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      1,
			    ],
			    "sql": "delete from "transaction" where "transaction"."id" = $1",
			  },
			]
		`);
	});
});

describe("expense.consumption", () => {
	it("sums linked amounts per Expense and reads the sum as a number", async () => {
		const { db, queries } = recordingDb(() => [[7, "12.5"]]);

		const rows = await caller(db).expense.consumption();

		expect(rows).toEqual([{ expenseId: 7, consumed: 12.5 }]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "expenseId", coalesce(sum("amount"), 0) from "transaction" where "transaction"."expenseId" is not null group by "transaction"."expenseId"",
			  },
			]
		`);
	});
});

describe("signed out", () => {
	it("rejects with UNAUTHORIZED before any query", async () => {
		const { db, queries } = recordingDb();

		await expect(caller(db, null).transaction.list({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		expect(queries).toHaveLength(0);
	});
});
