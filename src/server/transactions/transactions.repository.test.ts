import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ReconcilePlan,
	SyncedTransaction,
	Transaction,
	TransactionListQuery,
} from "~/domain/transactions";
import {
	Frequency,
	PossibleDuplicateStatus,
	Priority,
	Provenance,
} from "~/lib/constants";
import {
	pgError,
	type Respond,
	recordingDb,
	rowOf,
} from "~/server/db/recording-db.fake";
import { DrizzleTransactionsRepository } from "./transactions.repository";
import { transactions } from "./transactions.schema";

function harness(respond?: Respond) {
	const { db, queries } = recordingDb(respond);
	return {
		repository: new DrizzleTransactionsRepository({ db: db as never }),
		queries,
	};
}

// Pins the $defaultFn / $onUpdate timestamps drizzle adds to writes.
const NOW = new Date("2026-09-29T00:00:00.000Z");

const COLUMNS = Object.keys(getTableColumns(transactions));

const TRANSACTION = {
	id: 1,
	expenseId: 7,
	categoryId: null,
	date: new Date("2026-09-01T00:00:00.000Z"),
	description: "Groceries",
	receiptDescription: null,
	amount: 42.5,
	group: "Food",
	frequency: Frequency.OneOff,
	priority: Priority.MustHave,
	notes: null,
	provenance: Provenance.Manual,
	externalId: null,
	externalAccountId: null,
	accountName: null,
	createdAt: new Date("2026-09-01T01:00:00.000Z"),
	updatedAt: null,
} satisfies Transaction;

const FIELDS = {
	date: TRANSACTION.date,
	description: TRANSACTION.description,
	amount: TRANSACTION.amount,
	group: TRANSACTION.group,
	frequency: TRANSACTION.frequency,
	priority: TRANSACTION.priority,
	notes: null,
	expenseId: TRANSACTION.expenseId,
	categoryId: TRANSACTION.categoryId,
};

// What the list DTO hands over for `{}`.
const DEFAULT_QUERY: TransactionListQuery = {
	sortBy: "date",
	sortDir: "desc",
	limit: 50,
	offset: 0,
};

const isCount = (sql: string) => sql.startsWith("select cast(count(*)");
// The select list is pinned once by the default case; filter and sort cases
// pin only the tail they change.
const fromWhere = (sql: string) => sql.slice(sql.indexOf(" where "));
const fromOrderBy = (sql: string) => sql.slice(sql.indexOf(" order by "));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("list", () => {
	it("pages newest first and totals from the count row", async () => {
		const { repository, queries } = harness(({ sql }) =>
			isCount(sql) ? [[3]] : [rowOf(COLUMNS, TRANSACTION)],
		);

		const result = await repository.list(DEFAULT_QUERY);

		expect(result).toEqual({ items: [TRANSACTION], total: 3 });
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      50,
			    ],
			    "sql": "select "id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt" from "transaction" order by "transaction"."date" desc, "transaction"."id" desc limit $1",
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
		const { repository } = harness();

		await expect(repository.list(DEFAULT_QUERY)).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	// drizzle drops a zero offset, so the default case above renders no offset.
	it("pages with the given limit and offset", async () => {
		const { repository, queries } = harness();

		await repository.list({ ...DEFAULT_QUERY, limit: 20, offset: 40 });

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
			group: { group: "Food" },
			from: { from: new Date("2026-09-01T00:00:00.000Z") },
			to: { to: new Date("2026-09-30T00:00:00.000Z") },
		};
		const rendered: Record<string, unknown> = {};

		for (const [name, filter] of Object.entries(filters)) {
			const { repository, queries } = harness();
			await repository.list({ ...DEFAULT_QUERY, ...filter });
			rendered[name] = queries.map(({ sql, params }) => ({
				sql: fromWhere(sql),
				params,
			}));
		}

		expect(rendered).toMatchInlineSnapshot(`
			{
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
			  "group": [
			    {
			      "params": [
			        "Food",
			        50,
			      ],
			      "sql": " where "transaction"."group" = $1 order by "transaction"."date" desc, "transaction"."id" desc limit $2",
			    },
			    {
			      "params": [
			        "Food",
			      ],
			      "sql": " where "transaction"."group" = $1",
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
			      "sql": " where ("transaction"."description" ilike $1 or "transaction"."group" ilike $2 or "transaction"."notes" ilike $3) order by "transaction"."date" desc, "transaction"."id" desc limit $4",
			    },
			    {
			      "params": [
			        "%cafe%",
			        "%cafe%",
			        "%cafe%",
			      ],
			      "sql": " where ("transaction"."description" ilike $1 or "transaction"."group" ilike $2 or "transaction"."notes" ilike $3)",
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
			"group",
			"priority",
		] as const;
		const rendered: Record<string, string> = {};

		for (const sortBy of sortKeys) {
			const { repository, queries } = harness();
			await repository.list({ ...DEFAULT_QUERY, sortBy, sortDir: "asc" });
			const page = queries.find(({ sql }) => !isCount(sql));
			rendered[sortBy] = fromOrderBy(page?.sql ?? "");
		}

		expect(rendered).toMatchInlineSnapshot(`
			{
			  "amount": " order by "transaction"."amount" asc, "transaction"."id" desc limit $1",
			  "date": " order by "transaction"."date" asc, "transaction"."id" desc limit $1",
			  "description": " order by "transaction"."description" asc, "transaction"."id" desc limit $1",
			  "group": " order by "transaction"."group" asc, "transaction"."id" desc limit $1",
			  "priority": " order by "transaction"."priority" asc, "transaction"."id" desc limit $1",
			}
		`);
	});
});

describe("summary", () => {
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
		const { repository, queries } = harness(({ sql }) => summaryRows(sql));

		const result = await repository.summary();

		expect(result).toEqual({
			totals: { spend: 80, refunds: -20, net: 60, count: 3 },
			byPriority: [{ priority: Priority.MustHave, total: 60, count: 1 }],
			byFrequency: [{ frequency: Frequency.OneOff, total: 60, count: 1 }],
			byMonth: [{ month: "2026-09", total: 80 }],
			topGroups: [{ group: "Food", total: 80, count: 2 }],
		});
		expect(
			queries.map(({ sql, params }) => ({ sql, params })),
		).toMatchInlineSnapshot(`
			[
			  {
			    "params": [],
			    "sql": "select coalesce(sum(case when "transaction"."amount" > 0 then "transaction"."amount" else 0 end), 0), coalesce(sum(case when "amount" < 0 then "amount" else 0 end), 0), coalesce(sum("amount"), 0), cast(count(*) as int) from "transaction"",
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
			    "sql": "select to_char(date_trunc('month', "date"), 'YYYY-MM'), coalesce(sum(case when "transaction"."amount" > 0 then "transaction"."amount" else 0 end), 0) from "transaction" group by date_trunc('month', "transaction"."date") order by date_trunc('month', "transaction"."date")",
			  },
			  {
			    "params": [
			      8,
			    ],
			    "sql": "select "group", coalesce(sum(case when "transaction"."amount" > 0 then "transaction"."amount" else 0 end), 0), cast(count(*) as int) from "transaction" group by "transaction"."group" order by sum(case when "transaction"."amount" > 0 then "transaction"."amount" else 0 end) desc limit $1",
			  },
			]
		`);
	});

	it("reports zero totals when the totals row is missing", async () => {
		const { repository } = harness();

		await expect(repository.summary()).resolves.toEqual({
			totals: { spend: 0, refunds: 0, net: 0, count: 0 },
			byPriority: [],
			byFrequency: [],
			byMonth: [],
			topGroups: [],
		});
	});
});

describe("insert", () => {
	it("inserts the fields and returns the stored row", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, TRANSACTION),
		]);

		const row = await repository.insert(FIELDS);

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      null,
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
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, default, $5, $6, $7, $8, $9, default, default, default, default, $10, $11) returning "id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("returns undefined when the insert returns no row", async () => {
		const { repository } = harness();

		await expect(repository.insert(FIELDS)).resolves.toBeUndefined();
	});

	it("lets a driver error bubble", async () => {
		const { repository } = harness(() => pgError("23503"));

		const error = await repository.insert(FIELDS).catch((e: unknown) => e);

		expect(error).toMatchObject({ cause: { code: "23503" } });
	});
});

describe("update", () => {
	it("updates the row by id and returns it", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, TRANSACTION),
		]);

		const row = await repository.update(1, FIELDS);

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      null,
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
			    "sql": "update "transaction" set "expenseId" = $1, "categoryId" = $2, "date" = $3, "description" = $4, "amount" = $5, "group" = $6, "frequency" = $7, "priority" = $8, "notes" = $9, "updatedAt" = $10 where "transaction"."id" = $11 returning "id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("returns undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(repository.update(1, FIELDS)).resolves.toBeUndefined();
	});
});

const SYNCED: SyncedTransaction = {
	provenance: Provenance.Cdr,
	externalId: "txn_1",
	externalAccountId: "acct_1",
	accountName: "Everyday",
	date: new Date("2026-10-15T00:00:00.000Z"),
	description: "WOOLWORTHS",
	amount: 42.5,
};

const EMPTY_PLAN: ReconcilePlan = {
	refresh: [],
	add: [],
	adopt: [],
	flag: [],
	skipped: [],
};

// The recorded statements, minus params, so each case pins only the SQL it changes.
const statements = (queries: { sql: string }[]) => queries.map((q) => q.sql);

describe("findKnownExternalIds", () => {
	it("selects which of the bank ids are already rows", async () => {
		const { repository, queries } = harness(() => [["txn_1"]]);

		await expect(
			repository.findKnownExternalIds(Provenance.Cdr, ["txn_1", "txn_2"]),
		).resolves.toEqual(["txn_1"]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "cdr",
			      "txn_1",
			      "txn_2",
			    ],
			    "sql": "select "externalId" from "transaction" where ("transaction"."provenance" = $1 and "transaction"."externalId" in ($2, $3))",
			  },
			]
		`);
	});

	it("runs no statement for no ids", async () => {
		const { repository, queries } = harness();

		await expect(
			repository.findKnownExternalIds(Provenance.Cdr, []),
		).resolves.toEqual([]);
		expect(queries).toEqual([]);
	});
});

describe("findReviews", () => {
	it("selects every review of the bank ids", async () => {
		const { repository, queries } = harness(() => [[4, "txn_1", "kept", 1]]);

		await expect(
			repository.findReviews(Provenance.Cdr, ["txn_1"]),
		).resolves.toEqual([
			{
				id: 4,
				externalId: "txn_1",
				status: PossibleDuplicateStatus.Kept,
				transactionId: 1,
			},
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "cdr",
			      "txn_1",
			    ],
			    "sql": "select "id", "externalId", "status", "transactionId" from "possible_duplicate" where ("possible_duplicate"."provenance" = $1 and "possible_duplicate"."externalId" in ($2))",
			  },
			]
		`);
	});

	it("runs no statement for no ids", async () => {
		const { repository, queries } = harness();

		await expect(repository.findReviews(Provenance.Cdr, [])).resolves.toEqual(
			[],
		);
		expect(queries).toEqual([]);
	});
});

describe("findMatchCandidates", () => {
	it("selects household and retired-account rows no kept review holds", async () => {
		const { repository, queries } = harness(() => [
			[1, "2026-10-14T13:00:00.000Z", 42.5, "Coffee", null, null, 9],
		]);

		const rows = await repository.findMatchCandidates({
			from: new Date("2026-10-01T00:00:00.000Z"),
			to: new Date("2026-10-20T00:00:00.000Z"),
			liveAccountIds: ["acct_1", "acct_2"],
		});

		expect(rows).toEqual([
			{
				id: 1,
				date: new Date("2026-10-14T13:00:00.000Z"),
				amount: 42.5,
				description: "Coffee",
				externalId: null,
				externalAccountId: null,
				heldBy: 9,
			},
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "pending",
			      "2026-10-01T00:00:00.000Z",
			      "2026-10-20T00:00:00.000Z",
			      "acct_1",
			      "acct_2",
			      "kept",
			    ],
			    "sql": "select "transaction"."id", "transaction"."date", "transaction"."amount", "transaction"."description", "transaction"."externalId", "transaction"."externalAccountId", "heldBy" from "transaction" left join (select "transactionId", min("id") as "heldBy" from "possible_duplicate" where "possible_duplicate"."status" = $1 group by "possible_duplicate"."transactionId") "held" on "held"."transactionId" = "transaction"."id" where ("transaction"."date" >= $2 and "transaction"."date" < $3 and ("transaction"."externalId" is null or ("transaction"."externalAccountId" is not null and "transaction"."externalAccountId" not in ($4, $5))) and not exists (select "id" from "possible_duplicate" "kept" where ("kept"."transactionId" = "transaction"."id" and "kept"."status" = $6)))",
			  },
			]
		`);
	});
});

describe("applyReconcile", () => {
	it("refreshes and adds in one upsert of bank-owned columns only", async () => {
		const { repository, queries } = harness();

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			refresh: [SYNCED],
			add: [{ ...SYNCED, externalId: "txn_2", amount: -10 }],
			skipped: [{ ...SYNCED, externalId: "txn_3" }],
		});

		expect(counts).toEqual({ added: 1, adopted: 0, flagged: 0, known: 2 });
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
			      "2026-10-15T00:00:00.000Z",
			      "WOOLWORTHS",
			      42.5,
			      "cdr",
			      "txn_1",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			      "2026-10-15T00:00:00.000Z",
			      "WOOLWORTHS",
			      -10,
			      "cdr",
			      "txn_2",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, default, default, $1, $2, default, $3, default, default, default, default, $4, $5, $6, $7, $8, $9), (default, default, default, $10, $11, default, $12, default, default, default, default, $13, $14, $15, $16, $17, $18) on conflict ("provenance","externalId") where "transaction"."externalId" is not null do update set "date" = excluded."date", "amount" = excluded."amount", "externalAccountId" = excluded."externalAccountId", "accountName" = excluded."accountName", "updatedAt" = $19",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("adopts a row only while it still has no bank id", async () => {
		const { repository, queries } = harness(({ sql }) =>
			sql.startsWith('update "transaction"') ? [[1]] : [],
		);

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			adopt: [{ transactionId: 1, row: SYNCED, heldBy: null }],
		});

		expect(counts).toEqual({ added: 0, adopted: 1, flagged: 0, known: 0 });
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
			      "2026-10-15T00:00:00.000Z",
			      42.5,
			      "cdr",
			      "txn_1",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "transaction" set "date" = $1, "amount" = $2, "provenance" = $3, "externalId" = $4, "externalAccountId" = $5, "accountName" = $6, "updatedAt" = $7 where ("transaction"."id" = $8 and "transaction"."externalId" is null) returning "id"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("adds the bank row when its adoption updates nothing", async () => {
		const { repository, queries } = harness();

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			adopt: [{ transactionId: 1, row: SYNCED, heldBy: null }],
		});

		expect(counts).toEqual({ added: 1, adopted: 0, flagged: 0, known: 0 });
		expect(statements(queries).at(-2)).toContain('insert into "transaction"');
		expect(queries.at(-2)?.params).toContain("txn_1");
	});

	it("releases the review a held row had into a row of its own", async () => {
		const { repository, queries } = harness(({ sql }) => {
			if (sql.startsWith('update "transaction"')) return [[1]];
			if (sql.startsWith('delete from "possible_duplicate"'))
				return [
					[
						"cdr",
						"txn_close",
						"acct_1",
						"Everyday",
						41,
						"2026-10-13T00:00:00.000Z",
						"WOOLIES",
						9,
					],
				];
			return [];
		});

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			adopt: [{ transactionId: 1, row: SYNCED, heldBy: 9 }],
		});

		// The released review leaves the pending ones: its bank row is added now.
		expect(counts).toEqual({ added: 1, adopted: 1, flagged: -1, known: 0 });
		expect(queries.slice(2)).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			      "pending",
			    ],
			    "sql": "delete from "possible_duplicate" where ("possible_duplicate"."transactionId" = $1 and "possible_duplicate"."status" = $2) returning "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "id"",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-13T00:00:00.000Z",
			      "WOOLIES",
			      41,
			      "cdr",
			      "txn_close",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, default, default, $1, $2, default, $3, default, default, default, default, $4, $5, $6, $7, $8, $9) on conflict ("provenance","externalId") where "transaction"."externalId" is not null do update set "date" = excluded."date", "amount" = excluded."amount", "externalAccountId" = excluded."externalAccountId", "accountName" = excluded."accountName", "updatedAt" = $10",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	// A same-day copy that fell short joins a close one's review on the row.
	it("releases every review a held row had, not just the first", async () => {
		const review = (externalId: string, id: number) => [
			"cdr",
			externalId,
			"acct_1",
			"Everyday",
			41,
			"2026-10-13T00:00:00.000Z",
			"WOOLIES",
			id,
		];
		const { repository, queries } = harness(({ sql }) => {
			if (sql.startsWith('update "transaction"')) return [[1]];
			if (sql.startsWith('delete from "possible_duplicate"'))
				return [review("txn_close", 9), review("txn_same_day", 10)];
			return [];
		});

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			adopt: [{ transactionId: 1, row: SYNCED, heldBy: 9 }],
		});

		expect(counts).toEqual({ added: 2, adopted: 1, flagged: -2, known: 0 });
		const upsert = queries.find((q) =>
			q.sql.startsWith('insert into "transaction"'),
		);
		expect(upsert?.params).toEqual(
			expect.arrayContaining(["txn_close", "txn_same_day"]),
		);
	});

	// The overlap re-fetches the held review's bank row in the same batch as the exact one.
	it("adds a released review's bank row once, from this batch's copy", async () => {
		const { repository, queries } = harness(({ sql }) => {
			if (sql.startsWith('update "transaction"')) return [[1]];
			if (sql.startsWith('delete from "possible_duplicate"'))
				return [
					[
						"cdr",
						"txn_close",
						"acct_1",
						"Everyday",
						41,
						"2026-10-13T00:00:00.000Z",
						"WOOLIES",
						9,
					],
				];
			return [];
		});
		const refetched = {
			...SYNCED,
			externalId: "txn_close",
			amount: 41.5,
			description: "WOOLIES METRO",
		};

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			adopt: [{ transactionId: 1, row: SYNCED, heldBy: 9 }],
			flag: [
				{
					transactionId: 1,
					row: refetched,
					reviewId: 9,
					descriptionScore: null,
				},
			],
		});

		expect(counts).toEqual({ added: 1, adopted: 1, flagged: -1, known: 0 });
		const upsert = queries.find((q) =>
			q.sql.startsWith('insert into "transaction"'),
		);
		expect(upsert?.params).toEqual(
			expect.arrayContaining(["txn_close", 41.5, "WOOLIES METRO"]),
		);
		expect(upsert?.params).not.toContain(41);
		expect(statements(queries)).not.toContainEqual(
			expect.stringContaining('update "possible_duplicate"'),
		);
	});

	it("inserts a new review with its score, and refreshes a pending one's bank columns only", async () => {
		const { repository, queries } = harness(({ sql }) =>
			sql.startsWith('insert into "possible_duplicate"') ? [[5]] : [],
		);

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			flag: [
				{
					transactionId: 1,
					row: SYNCED,
					reviewId: null,
					descriptionScore: 0.81,
				},
				{
					transactionId: 2,
					row: { ...SYNCED, externalId: "txn_2" },
					reviewId: 4,
					descriptionScore: null,
				},
			],
		});

		expect(counts).toEqual({ added: 0, adopted: 0, flagged: 1, known: 1 });
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
			      1,
			      "cdr",
			      "txn_1",
			      "acct_1",
			      "Everyday",
			      42.5,
			      "2026-10-15T00:00:00.000Z",
			      "WOOLWORTHS",
			      0.81,
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "possible_duplicate" ("id", "transactionId", "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "descriptionScore", "status", "createdAt", "updatedAt") values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, default, $10, $11) on conflict ("provenance","externalId") do nothing returning "id"",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "acct_1",
			      "Everyday",
			      42.5,
			      "2026-10-15T00:00:00.000Z",
			      "WOOLWORTHS",
			      "2026-09-29T00:00:00.000Z",
			      4,
			      "pending",
			    ],
			    "sql": "update "possible_duplicate" set "externalAccountId" = $1, "accountName" = $2, "amount" = $3, "date" = $4, "description" = $5, "updatedAt" = $6 where ("possible_duplicate"."id" = $7 and "possible_duplicate"."status" = $8)",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("counts a new review that lost the race as known", async () => {
		const { repository } = harness();

		const counts = await repository.applyReconcile({
			...EMPTY_PLAN,
			flag: [
				{
					transactionId: 1,
					row: SYNCED,
					reviewId: null,
					descriptionScore: 0.81,
				},
			],
		});

		expect(counts).toEqual({ added: 0, adopted: 0, flagged: 0, known: 1 });
	});

	it("rolls the whole plan back on a driver error", async () => {
		const { repository, queries } = harness(({ sql }) =>
			sql.startsWith('insert into "transaction"') ? pgError("21000") : [],
		);

		await expect(
			repository.applyReconcile({ ...EMPTY_PLAN, add: [SYNCED] }),
		).rejects.toMatchObject({ cause: { code: "21000" } });
		expect(statements(queries).at(-1)).toBe("rollback");
	});

	it("runs no statement inside an empty plan", async () => {
		const { repository, queries } = harness();

		await repository.applyReconcile(EMPTY_PLAN);

		expect(statements(queries)).toEqual(["begin", "commit"]);
	});
});

describe("listPendingDuplicates", () => {
	it("joins each pending review to its household row, newest bank date first", async () => {
		const { repository, queries } = harness(() => [
			[
				4,
				"2026-10-15T00:00:00.000Z",
				41,
				"WOOLIES",
				"Everyday",
				1,
				"2026-10-14T13:00:00.000Z",
				42.5,
				"Groceries",
				null,
				"manual",
			],
		]);

		await expect(repository.listPendingDuplicates()).resolves.toEqual([
			{
				id: 4,
				bank: {
					date: new Date("2026-10-15T00:00:00.000Z"),
					amount: 41,
					description: "WOOLIES",
					accountName: "Everyday",
				},
				mine: {
					id: 1,
					date: new Date("2026-10-14T13:00:00.000Z"),
					amount: 42.5,
					description: "Groceries",
					accountName: null,
					provenance: Provenance.Manual,
				},
			},
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "pending",
			    ],
			    "sql": "select "possible_duplicate"."id", "possible_duplicate"."date", "possible_duplicate"."amount", "possible_duplicate"."description", "possible_duplicate"."accountName", "transaction"."id", "transaction"."date", "transaction"."amount", "transaction"."description", "transaction"."accountName", "transaction"."provenance", "possible_duplicate"."descriptionScore" from "possible_duplicate" inner join "transaction" on "transaction"."id" = "possible_duplicate"."transactionId" where "possible_duplicate"."status" = $1 order by "possible_duplicate"."date" desc, "possible_duplicate"."id" desc",
			  },
			]
		`);
	});
});

describe("countPendingDuplicates", () => {
	it("counts pending reviews", async () => {
		const { repository, queries } = harness(() => [[3]]);

		await expect(repository.countPendingDuplicates()).resolves.toBe(3);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "pending",
			    ],
			    "sql": "select cast(count(*) as int) from "possible_duplicate" where "possible_duplicate"."status" = $1",
			  },
			]
		`);
	});

	it("reports zero when the count row is missing", async () => {
		const { repository } = harness();

		await expect(repository.countPendingDuplicates()).resolves.toBe(0);
	});
});

describe("resolving a review", () => {
	// The bank's half of review 4, as the delete returns it.
	const TAKEN = [
		"cdr",
		"txn_close",
		"acct_1",
		"Everyday",
		41,
		"2026-10-13T00:00:00.000Z",
		"WOOLIES",
		1,
	];
	const takeById =
		'delete from "possible_duplicate" where ("possible_duplicate"."id"';
	const taking = ({ sql }: { sql: string }) =>
		sql.startsWith(takeById) ? [TAKEN] : [];

	it("keep mine marks only a pending review kept", async () => {
		const { repository, queries } = harness(() => [[4]]);

		await expect(repository.keepMine(4)).resolves.toBe(true);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "kept",
			      "2026-09-29T00:00:00.000Z",
			      4,
			      "pending",
			    ],
			    "sql": "update "possible_duplicate" set "status" = $1, "updatedAt" = $2 where ("possible_duplicate"."id" = $3 and "possible_duplicate"."status" = $4) returning "id"",
			  },
			]
		`);
	});

	it("use bank's moves the bank values onto the household row, not its description", async () => {
		const { repository, queries } = harness(taking);

		await expect(repository.useBanks(4)).resolves.toBe(true);
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
			      4,
			      "pending",
			    ],
			    "sql": "delete from "possible_duplicate" where ("possible_duplicate"."id" = $1 and "possible_duplicate"."status" = $2) returning "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "transactionId"",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-13T00:00:00.000Z",
			      41,
			      "cdr",
			      "txn_close",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "transaction" set "date" = $1, "amount" = $2, "provenance" = $3, "externalId" = $4, "externalAccountId" = $5, "accountName" = $6, "updatedAt" = $7 where "transaction"."id" = $8",
			  },
			  {
			    "method": "all",
			    "params": [
			      1,
			      "pending",
			    ],
			    "sql": "delete from "possible_duplicate" where ("possible_duplicate"."transactionId" = $1 and "possible_duplicate"."status" = $2) returning "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "id"",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("use bank's releases the row's other review as its own row", async () => {
		const sameDay = [
			"cdr",
			"txn_same_day",
			"acct_1",
			"Everyday",
			41,
			"2026-10-10T00:00:00.000Z",
			"WOOLWORTHS SYDNEY",
			12,
		];
		const { repository, queries } = harness(({ sql }) =>
			sql.startsWith(takeById)
				? [TAKEN]
				: sql.startsWith('delete from "possible_duplicate"')
					? [sameDay]
					: [],
		);

		await expect(repository.useBanks(4)).resolves.toBe(true);
		expect(queries.slice(3, -1)).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			      "pending",
			    ],
			    "sql": "delete from "possible_duplicate" where ("possible_duplicate"."transactionId" = $1 and "possible_duplicate"."status" = $2) returning "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "id"",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-10T00:00:00.000Z",
			      "WOOLWORTHS SYDNEY",
			      41,
			      "cdr",
			      "txn_same_day",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, default, default, $1, $2, default, $3, default, default, default, default, $4, $5, $6, $7, $8, $9) on conflict do nothing",
			  },
			]
		`);
	});

	it("both are real adds the bank row once", async () => {
		const { repository, queries } = harness(taking);

		await expect(repository.bothReal(4)).resolves.toBe(true);
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
			      4,
			      "pending",
			    ],
			    "sql": "delete from "possible_duplicate" where ("possible_duplicate"."id" = $1 and "possible_duplicate"."status" = $2) returning "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description", "transactionId"",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-13T00:00:00.000Z",
			      "WOOLIES",
			      41,
			      "cdr",
			      "txn_close",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, default, default, $1, $2, default, $3, default, default, default, default, $4, $5, $6, $7, $8, $9) on conflict do nothing",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it.each([
		["keepMine", (r: DrizzleTransactionsRepository) => r.keepMine(4)],
		["useBanks", (r: DrizzleTransactionsRepository) => r.useBanks(4)],
		["bothReal", (r: DrizzleTransactionsRepository) => r.bothReal(4)],
	])(
		"%s reports false and writes nothing without a pending review",
		async (_, resolve) => {
			const { repository, queries } = harness();

			await expect(resolve(repository)).resolves.toBe(false);
			expect(
				statements(queries).some((q) =>
					/^(insert|update) "transaction"/.test(q),
				),
			).toBe(false);
		},
	);
});

describe("findUnplanned", () => {
	it("selects unlinked Spend in the half-open window, by Group then newest", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, TRANSACTION),
		]);

		const rows = await repository.findUnplanned({
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
			    "sql": "select "id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt" from "transaction" where ("transaction"."amount" > $1 and "transaction"."expenseId" is null and "transaction"."date" >= $2 and "transaction"."date" < $3) order by "transaction"."categoryId" asc, "transaction"."date" desc, "transaction"."id" desc",
			  },
			]
		`);
	});
});

describe("findDescriptions", () => {
	it("selects the id and description of each id", async () => {
		const { repository, queries } = harness(() => [[1, "Groceries"]]);

		await expect(repository.findDescriptions([1, 2])).resolves.toEqual([
			{ id: 1, description: "Groceries" },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			      2,
			    ],
			    "sql": "select "id", "description" from "transaction" where "transaction"."id" in ($1, $2)",
			  },
			]
		`);
	});
});

describe("listDescriptions", () => {
	it("selects each distinct description once", async () => {
		const { repository, queries } = harness(() => [
			["Groceries"],
			["NETFLIX.COM"],
		]);

		await expect(repository.listDescriptions()).resolves.toEqual([
			"Groceries",
			"NETFLIX.COM",
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select distinct "description" from "transaction"",
			  },
			]
		`);
	});
});

describe("findEmbeddings", () => {
	it("reads the cached vectors of these descriptions under one model", async () => {
		const { repository, queries } = harness(() => [["NETFLIX", "[0.6,0.8]"]]);

		await expect(
			repository.findEmbeddings("titan", ["NETFLIX", "COLES"]),
		).resolves.toEqual([{ description: "NETFLIX", embedding: [0.6, 0.8] }]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "titan",
			      "NETFLIX",
			      "COLES",
			    ],
			    "sql": "select "description", "embedding" from "description_embedding" where ("description_embedding"."model" = $1 and "description_embedding"."description" in ($2, $3))",
			  },
			]
		`);
	});

	it("runs no statement for no descriptions", async () => {
		const { repository, queries } = harness();

		await expect(repository.findEmbeddings("titan", [])).resolves.toEqual([]);
		expect(queries).toEqual([]);
	});
});

describe("saveEmbeddings", () => {
	it("inserts each vector under the model, skipping one already cached", async () => {
		const { repository, queries } = harness();

		await repository.saveEmbeddings("titan", [
			{ description: "NETFLIX", embedding: [0.6, 0.8] },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "execute",
			    "params": [
			      "titan",
			      "NETFLIX",
			      "[0.6,0.8]",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "description_embedding" ("id", "model", "description", "embedding", "createdAt") values (default, $1, $2, $3, $4) on conflict ("model","description") do nothing",
			  },
			]
		`);
	});
});

describe("findInDateWindow", () => {
	it("selects the match fields of every row in the half-open window", async () => {
		const { repository, queries } = harness(() => [
			[1, "Groceries", 42.5, "2026-09-01T00:00:00.000Z"],
		]);

		const rows = await repository.findInDateWindow({
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-15T00:00:00.000Z"),
		});

		expect(rows).toEqual([
			{
				id: 1,
				description: "Groceries",
				amount: 42.5,
				date: new Date("2026-09-01T00:00:00.000Z"),
			},
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      "2026-09-01T00:00:00.000Z",
			      "2026-09-15T00:00:00.000Z",
			    ],
			    "sql": "select "id", "description", "amount", "date" from "transaction" where ("transaction"."date" >= $1 and "transaction"."date" < $2)",
			  },
			]
		`);
	});
});

describe("findSyncedValues", () => {
	it("selects the provenance and bank-owned values of the id", async () => {
		const { repository, queries } = harness(() => [
			["cdr", 42.5, "2026-09-01T00:00:00.000Z"],
		]);

		await expect(repository.findSyncedValues(1)).resolves.toEqual({
			provenance: Provenance.Cdr,
			amount: 42.5,
			date: TRANSACTION.date,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			    ],
			    "sql": "select "provenance", "amount", "date" from "transaction" where "transaction"."id" = $1",
			  },
			]
		`);
	});

	it("returns undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(repository.findSyncedValues(1)).resolves.toBeUndefined();
	});
});

describe("findLink", () => {
	it("selects only the expense and category links of the id", async () => {
		const { repository, queries } = harness(() => [[7, null]]);

		await expect(repository.findLink(1)).resolves.toEqual({
			expenseId: 7,
			categoryId: null,
		});
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      1,
			    ],
			    "sql": "select "expenseId", "categoryId" from "transaction" where "transaction"."id" = $1",
			  },
			]
		`);
	});

	it("returns undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(repository.findLink(1)).resolves.toBeUndefined();
	});
});

describe("setLink", () => {
	it("writes both links, plus the updatedAt stamp", async () => {
		const { repository, queries } = harness(() => [
			rowOf(COLUMNS, TRANSACTION),
		]);

		const row = await repository.setLink(1, { expenseId: 7, categoryId: null });

		expect(row).toEqual(TRANSACTION);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [
			      7,
			      null,
			      "2026-09-29T00:00:00.000Z",
			      1,
			    ],
			    "sql": "update "transaction" set "expenseId" = $1, "categoryId" = $2, "updatedAt" = $3 where "transaction"."id" = $4 returning "id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt"",
			  },
			]
		`);
	});

	it("returns undefined when no row matches the id", async () => {
		const { repository } = harness();

		await expect(
			repository.setLink(1, { expenseId: 7, categoryId: null }),
		).resolves.toBeUndefined();
	});
});

describe("delete", () => {
	it("adds the bank rows its reviews hold, then deletes by id", async () => {
		const { repository, queries } = harness(({ sql }) =>
			sql.startsWith("select")
				? [
						[
							"cdr",
							"txn_close",
							"acct_1",
							"Everyday",
							41,
							"2026-10-13T00:00:00.000Z",
							"WOOLIES",
						],
					]
				: [],
		);

		await repository.delete(1);

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
			      1,
			    ],
			    "sql": "select "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description" from "possible_duplicate" where "possible_duplicate"."transactionId" = $1",
			  },
			  {
			    "method": "execute",
			    "params": [
			      "2026-10-13T00:00:00.000Z",
			      "WOOLIES",
			      41,
			      "cdr",
			      "txn_close",
			      "acct_1",
			      "Everyday",
			      "2026-09-29T00:00:00.000Z",
			      "2026-09-29T00:00:00.000Z",
			    ],
			    "sql": "insert into "transaction" ("id", "expenseId", "categoryId", "date", "description", "receiptDescription", "amount", "group", "frequency", "priority", "notes", "provenance", "externalId", "externalAccountId", "accountName", "createdAt", "updatedAt") values (default, default, default, $1, $2, default, $3, default, default, default, default, $4, $5, $6, $7, $8, $9) on conflict do nothing",
			  },
			  {
			    "method": "execute",
			    "params": [
			      1,
			    ],
			    "sql": "delete from "transaction" where "transaction"."id" = $1",
			  },
			  {
			    "method": "execute",
			    "params": [],
			    "sql": "commit",
			  },
			]
		`);
	});

	it("only deletes when no review holds the row", async () => {
		const { repository, queries } = harness();

		await repository.delete(1);

		expect(statements(queries)).toEqual([
			"begin",
			'select "provenance", "externalId", "externalAccountId", "accountName", "amount", "date", "description" from "possible_duplicate" where "possible_duplicate"."transactionId" = $1',
			'delete from "transaction" where "transaction"."id" = $1',
			"commit",
		]);
	});
});

describe("consumedByExpense", () => {
	it("sums linked amounts per Expense and reads the sum as a number", async () => {
		const { repository, queries } = harness(() => [[7, "12.5"]]);

		const rows = await repository.consumedByExpense();

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

describe("datedAmounts", () => {
	it("selects every Transaction's date and amount", async () => {
		const { repository, queries } = harness(() => [
			["2026-09-01T00:00:00.000Z", 42.5],
		]);

		const rows = await repository.datedAmounts();

		expect(rows).toEqual([
			{ date: new Date("2026-09-01T00:00:00.000Z"), amount: 42.5 },
		]);
		expect(queries).toMatchInlineSnapshot(`
			[
			  {
			    "method": "all",
			    "params": [],
			    "sql": "select "date", "amount" from "transaction"",
			  },
			]
		`);
	});
});
