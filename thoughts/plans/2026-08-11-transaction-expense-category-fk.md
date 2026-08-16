# Transaction → Expense Category FK Implementation Plan

## Context
Transactions currently carry only a free-text `category` string; there is no structured link to the managed `expense_category` table. We want a real many-to-one relationship — many transactions reference one `expense_category` row — so a transaction can be tied to a managed category by id. The existing free-text `category` column stays and **coexists** with the new FK (no migration of existing views/filters).

## Current State
- `transaction` table: free-text `category` column, no FK — `src/server/transactions/transactions.schema.ts:11`. Indexes at `:21-24`.
- Managed categories: `expense_category` table, integer identity id — `src/server/expenses/categories.schema.ts:3-13` (export `expenseCategories`).
- **No real FK exists between any two domain tables.** `expense`↔category is a soft string-join on name — `src/server/api/routers/category.ts:27`. The only real FK + `relations()` prior art is auth tables — `src/server/db/shared.schema.ts:30-33,66-77`.
- All DB access is inline in tRPC routers; there is no service/repository layer (the heavier `.claude/rules/server-architecture.md` arch is not implemented here). Transaction CRUD + Zod input: `src/server/api/routers/transaction.ts:25-33` (`transactionInput`), `:71-95` (`list`), `:166-186` (`create`/`update`).
- Transaction form (client): `src/app/_components/transactions/transaction-form.tsx`. Dynamic-category-select precedent (from `api.category.list`): `src/app/_components/expenses/expense-form.tsx:26-29,95-109`.
- Schema discovery glob `./src/server/**/*.schema.ts`; every domain module merged into `db.query.*` — `src/server/db/index.ts:5-18`. Migrations: two-step `make db_generate` → `make db_migrate` (`.claude/rules/database-migrations.md`); never `drizzle-kit push`. Latest migration `0001`; journal `drizzle/meta/_journal.json`.
- Tests: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]` — `vitest.config.ts`. Only pure-unit tests exist (`src/lib/utils.test.ts`, `src/server/auth/secondary-storage.test.ts`); **no DB or component test harness** (no `createCaller`, no jsdom).

## Desired End State
- `transaction` table has a nullable `expenseCategoryId` integer column with a FK to `expense_category(id)`, `ON DELETE SET NULL`, plus an index — recorded in a git-tracked migration and applied.
- `transaction.create` / `transaction.update` accept and persist `expenseCategoryId`; `transaction.list` returns `expenseCategoryId` and the joined `expenseCategoryName`.
- The transaction form lets a user pick a managed category (or none) from `api.category.list`; the selection round-trips on edit and is visible in the transactions list.
- Existing free-text `category` behaviour (filters, search, summary, sort) is unchanged.

## Out of Scope
- Removing/backfilling/replacing the free-text `category` column.
- Filtering, sorting, searching, or summarising transactions by `expenseCategoryId`.
- Adding Drizzle `relations()` / `db.query` relational reads (codebase uses `select().leftJoin()`).
- Blocking category deletion when transactions reference it (handled by `ON DELETE SET NULL`; category `delete` guard at `category.ts:102-135` stays as-is).

## Approach
Additive FK, mirroring the auth-table FK pattern (`shared.schema.ts`) rather than the name-string soft join. The column is nullable so no backfill is needed and the form can leave it empty. Surface the category name in `transaction.list` via a `leftJoin` on `expenseCategories` (mirrors `category.ts:27`) so consumers don't each re-fetch the category list. Only the transactions schema imports `expenseCategories` (single direction — no import cycle), which the adr005 read-model-join rule permits. Three phases: schema+migration, API wire-through (with a unit test on the Zod input), then the form UI.

## Phase 1: Schema + migration
### Changes
- `src/server/transactions/transactions.schema.ts` — import `expenseCategories` from `~/server/expenses/categories.schema`; add column `expenseCategoryId: d.integer().references(() => expenseCategories.id, { onDelete: "set null" })` (nullable — no `.notNull()`); add `index("transaction_expense_category_idx").on(t.expenseCategoryId)` to the index list at `:21-24`.
- `drizzle/0002_<generated>.sql` (+ `drizzle/meta/0002_snapshot.json`, updated `_journal.json`) — produced by `make db_generate`: `ALTER TABLE "transaction" ADD COLUMN "expenseCategoryId" integer`, `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE set null`, `CREATE INDEX "transaction_expense_category_idx"`. Review the generated SQL, then `make db_migrate`.

### Success
**Automated**
- [ ] `make db_generate` produces exactly one new migration (nullable add-column + FK + index); no unintended diffs
- [ ] `make db_migrate` applies cleanly
- [ ] `make check` passes (includes `db:check` — migrations consistent with schema)
- [ ] `make build` passes

**Manual**
- [ ] `expenseCategoryId` column + FK constraint + index present in the DB (db studio / psql)
- [ ] Deleting a referenced `expense_category` row sets referencing transactions' `expenseCategoryId` to NULL (spot check)
- [ ] Generated migration file committed alongside the schema change

## Phase 2: API wire-through
### Changes
- `src/server/api/routers/transaction.ts`:
  - Export the Zod input (`export const transactionInput`) at `:25` and add `expenseCategoryId: z.number().int().nullable().optional()`.
  - `create` (`:166`) / `update` (`:176`) — value flows through the existing `...input` / `...values` spread; no extra handling. (Clearing the link = form sends `null`; omitting leaves it unchanged on update.)
  - `list` (`:71-95`) — import `getTableColumns` from `drizzle-orm` and `expenseCategories` from `~/server/expenses/categories.schema`; change the items query to `.select({ ...getTableColumns(transactions), expenseCategoryName: expenseCategories.name }).from(transactions).leftJoin(expenseCategories, eq(transactions.expenseCategoryId, expenseCategories.id))` — keep existing `where` / `orderBy` / `limit` / `offset`. Count query at `:85-89` is unchanged.
- `src/server/api/routers/transaction.test.ts` (new) — unit test on `transactionInput`: accepts `expenseCategoryId` as a positive int, as `null`, and when omitted; rejects a string and a non-integer. Written test-first (TDD), then add the field.

### Success
**Automated**
- [ ] `make test` passes (new `transaction.test.ts` green)
- [ ] `make check` passes
- [ ] `make build` passes

**Manual**
- [ ] Creating/updating a transaction with an `expenseCategoryId` persists it; `transaction.list` returns `expenseCategoryId` + `expenseCategoryName` (null when unset)

## Phase 3: Form UI
### Changes
- `src/app/_components/transactions/transaction-form.tsx` — add `const { data: managedCategories } = api.category.list.useQuery();`; add state `expenseCategoryId: number | null` (reset in the `open`/`transaction` effect at `:40-49` from `transaction?.expenseCategoryId ?? null`); add a `<Field label="Expense category">` with a `<Select>` whose first option is "None" (value `""`) and remaining options map `managedCategories` (`value={c.id}`, label `c.name`); `onChange` sets `e.target.value ? Number(e.target.value) : null`; include `expenseCategoryId` in the `payload` at `:65-73`. `Transaction` type at `:13` picks up the new fields automatically from Phase 2.
- `src/app/_components/transactions/transactions-view.tsx` — display `expenseCategoryName` in the row where category is shown (modest secondary text/badge; leave detailed layout to the frontend-design skill), so the managed category is visible without re-fetching `category.list`.

### Success
**Automated**
- [ ] `make check` passes
- [ ] `make build` passes

**Manual**
- [ ] Add transaction → pick a managed category → save; it appears in the list
- [ ] Edit that transaction → the category is preselected; changing to "None" clears it
- [ ] Empty managed-category list → select shows only "None"; form still submits
- [ ] `/design-review`

## Validate
- [ ] `/code-review` over the whole branch

## References
- Ticket: none (plain-slug plan)
- Schema prior art (FK + relations): `src/server/db/shared.schema.ts:30-33,66-77`
- Soft-join precedent to mirror for the `leftJoin`: `src/server/api/routers/category.ts:27`
- Dynamic category `<Select>` precedent: `src/app/_components/expenses/expense-form.tsx:26-29,95-109`
- Transaction CRUD + Zod input: `src/server/api/routers/transaction.ts:25-33,71-95,166-186`
- Transaction form: `src/app/_components/transactions/transaction-form.tsx`
- Schema layout / migration rules: `.claude/rules/database-migrations.md`; adr005 `docs/adr/adr005-per-domain-drizzle-schema-files.md`
- Schema merge point: `src/server/db/index.ts:5-18`
