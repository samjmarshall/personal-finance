---
date: 2026-10-02
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022]
status: Ready to implement
---
# tRPC 3-tier migration, step 2: expenses + categories — Implementation Plan

## Context

Step 1 shipped the foundation and migrated transactions. `expense.ts` and `category.ts` are still plain routers that query Drizzle through `ctx.db` and throw `TRPCError` inline. The transaction list still left-joins two tables owned by expenses. This is migration step 2 of the design. It moves both routers into `src/server/expenses/` behind one `ExpensesService` (adr021). The transaction list then gets its Expense and Expense Category names from that service instead of a join (adr022). The member sees no change: every tRPC path, code and message stays the same.

## Current State

- **The expense router** (`src/server/api/routers/expense.ts`, 54 lines) runs Drizzle inline:
  - `list` (`:13-22`) orders by `category`, `sortOrder`, `name`.
  - `consumption` (`:24-27`) already calls `ctx.services.transactions.consumedByExpense()` (step 1).
  - `create` (`:29-34`) and `update` (`:36-46`) go through `assertRow`. So a missing id on `update` is `INTERNAL_SERVER_ERROR` "Failed to update expense.", not `NOT_FOUND`.
  - `delete` (`:48-53`) returns `{ success: true }`.
- **The category router** (`src/server/api/routers/category.ts`, 172 lines):
  - `list` (`:17-33`) left-joins `expenses` on `expenses.category = expenseCategories.name` for `expenseCount`.
  - `create` (`:35-71`) reads `coalesce(max(sortOrder) + 1, 0)` (`:40-47`), trims the name and description (`:49-53`), then inserts. A unique violation becomes `CONFLICT` "A category with that name already exists." (`:62-68`).
  - `update` (`:73-121`) runs a pre-select that throws `NOT_FOUND` "Category not found." (`:78-87`). Then one `ctx.db.transaction` (`:95-108`) rewrites `expenses.category` when the name changes, and updates the category. A unique violation gives the same `CONFLICT` (`:112-118`).
  - `reorder` (`:123-136`) runs one update per id inside a `ctx.db.transaction`, with `sortOrder` = the id's position.
  - `delete` (`:138-171`) runs a pre-select (`NOT_FOUND`), then counts the expenses using the category's name. If any do, it throws `CONFLICT` `Cannot delete "<name>" — <n> expense(s) still use it.` with no cause (`:158-165`). Otherwise it deletes.
  - **Neither router has a test.**
- **The transaction list joins expenses' tables.** `DrizzleTransactionsRepository.list` (`src/server/transactions/transactions.repository.ts:104-120`) left-joins `expenses` and `expenseCategories` and selects `expenseName` and `expenseCategoryName`. It imports both schemas (`:32-33`). `TransactionsService.list` (`transactions.service.ts:36-38`) passes the result through. The result shape is `TransactionListItem` (`src/domain/transactions/transaction.interface.ts:25-30`).
- **The architecture to-do list** (`src/server/architecture.test.ts:38-70`) has 32 entries. This step owns 7 of them:
  - rule 1 `transactions.repository.ts` → `categories.schema` and → `expenses.schema` (`:41-42`)
  - rule 3 `routers/category.ts` ×3 and `routers/expense.ts` ×2 (`:54-58`)
- **Wiring.**
  - `src/server/api/services.ts:7-11` builds only `transactions`.
  - `src/server/api/root.ts:4-5` imports both routers from `routers/`, under the keys `category` and `expense` (`:21-22`).
  - Nothing else imports `expenseRouter` or `categoryRouter`.
- **The fake db can't run a database transaction.** `recordingDb()` (`src/server/db/recording-db.fake.ts:17-27`) is built on pg-proxy, and pg-proxy's `transaction` throws "Transactions are not supported by the Postgres Proxy driver" (`node_modules/drizzle-orm/pg-proxy/session.js:35-37`). Category `update` and `reorder` both use one. Production uses postgres-js (`src/server/db/index.ts:1`), which supports them.
- **Precedents to mirror:**
  - The step-1 tiers: `transactions.repository.ts:59-68` (deps and `db: typeof realDb`), `transactions.service.ts:25-34`, `transactions.trpc.controller.ts:11-42`.
  - Their tests:
    - `transactions.repository.test.ts:13-30`: a harness over `recordingDb`, plus `rowOf` ordered by `getTableColumns`.
    - `transactions.service.test.ts:12-35`: `pgError` with the drizzle `.cause` hop, an `unstaged` default and `serviceWith`.
    - `transactions.trpc.controller.test.ts:10-26`: `callerWith` and `recorder`.
  - `createTestCaller` (`src/server/api/test-caller.ts:20-33`).
  - Inferred DTO type exports (`src/domain/transactions/index.ts:1-13`).
  - `isPgViolation` / `PgViolation` (`src/server/errors/parse-error.ts`), and the `rethrowFkConflict` shape (`src/server/errors/fk-conflict.ts:6-11`).
- **Glossary** (`CONTEXT.md`): **Expense** (`:28`), **Expense Category** (`:62`), **Group** (`:96`). An Expense files its Expense Category by name text (`expenses.schema.ts:12`). A Transaction links its Expense Category by id, with FK `onDelete: "set null"` (`transactions.schema.ts:21,24`).
- **Client callers:** `api.expense.*` and `api.category.*` are used under `src/app/(dashboard)/` (`expenses/`, `expenses/categories/`, `expenses/unplanned/`, `transactions/`, `receipts/` and the dashboard `page.tsx:23`). Their paths do not change.

## Desired End State

- **`expense.*` is served by `src/server/expenses/expenses.trpc.controller.ts`, and `category.*` by `src/server/expenses/categories.trpc.controller.ts`.** Both call `ExpensesService` → `ExpensesRepository` / `DrizzleExpensesRepository`. `expense.consumption` still calls `ctx.services.transactions.consumedByExpense()`.
- **A category rename still rewrites `expense.category` in the same database transaction**, inside the repository.
- **The transaction list makes no join.** `TransactionsService.list` makes one `ExpensesService.namesByIds` call per page and merges the names in memory. A null link, or an id with no row, gives a null name, as the left join did.
- **`src/server/api/routers/expense.ts` and `category.ts` are gone.** `services.ts` builds `expenses` and gives it to `transactions`.
- **The to-do list has 25 entries.**
- **`recordingDb()` supports `db.transaction(cb)`** and records begin/commit/rollback.
- **Every tRPC path, code and message matches today's**, including `expense.update`'s `INTERNAL_SERVER_ERROR` on a missing id.
- `make check`, `make test` and `make build` are green.

## Out of Scope

- **Steps 3–7**:
  - income, balances and settings
  - members and the allowlist
  - cashflow's `expenses.schema` import and copied consumption query
  - the receipts router's and the worker repository's reads of expenses' tables
  - deleting `src/server/api/lib/`
  - removing `ctx.db`
- **Turning `expense.update`'s missing-row 500 into `NOT_FOUND`.** That would change what the member sees.
- **Making category `delete` atomic.** Its pre-select, count and delete stay three statements, as today.
- **Fixing the "1 expense still use it." grammar.** It is pinned as is.
- **Any tRPC path, response shape or client change.** No `expenses.module.ts`; that arrives in step 6.
- **Changing adr021 or adr022 `Status:`.** Both stay Proposed.

## Approach

1. **Pin today's behaviour.** Characterization tests cover every `expense.*` and `category.*` procedure: SQL, params, codes and messages, captured through `recordingDb`. `recordingDb` first learns to run a database transaction.
2. **Migrate both routers onto one service and one repository**, with the SQL lifted verbatim, in step 1's two-commit shape. Commit A proves the snapshots don't move. Commit B deletes the old routers.
3. **Swap the transaction list's join for the batched names lookup.** The only intended SQL diff is the two dropped joins and their two name columns. Service tests pin the left-join semantics.
4. **Update the docs.**

The names now come from a second read. A rename that lands between the two reads can show the old name for one fetch. The design accepted this (§ Replacing a join).

## Phase 1: Characterize expenses and categories

Tests plus one test fake. No `src` behaviour changes.

### Changes

- **`src/server/db/recording-db.fake.ts` — support `db.transaction(cb)`.**
  - Override `transaction` on the returned instance.
  - It records `{ sql: "begin", params: [], method: "execute" }` and runs `cb` over the same recording db (cast once).
  - Then it records `commit`. If `cb` throws, it records `rollback` and rethrows.
  - Comment: pg-proxy's own `transaction` throws (`pg-proxy/session.js:35-37`), and nothing here nests transactions.
  - The existing callers (`transactions.repository.test.ts`) are unaffected.
- **New `src/server/api/routers/expense.test.ts`: characterization over the unchanged router.**
  - **Harness.**
    - `createCallerFactory(createTRPCRouter({ expense: expenseRouter }))({ db, session: { user: { id: "member-1" } }, services: {}, headers: new Headers() } as never)`, with `db` from `recordingDb(respond)`.
    - No `vi.mock`, because `trpc.ts` no longer loads `db` or `auth` (step 1).
    - `rowOf(fields, fixture)` ordered by `getTableColumns(expenses)` (copy of `transactions.repository.test.ts:28-30`).
  - **What each case pins.** SQL text and params go in `toMatchInlineSnapshot`. Codes and messages use `toMatchObject`.
  - **`list`:** the select, ordered by `category`, `sortOrder`, `name` asc. Staged rows come back as `Expense`s.
  - **`create`:** the insert SQL and params, and the returned row. Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to create expense.".
  - **`update`:**
    - The update SQL and params. Omitted `fortnight` / `month` / `year` are absent from `set`, which pins `expense.dto.test.ts:176-181` at the SQL level.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to update expense.".
  - **`delete`:** the delete SQL, and the result `{ success: true }`.
  - **Signed out:** `session: null` → `UNAUTHORIZED` with zero queries.
- **New `src/server/api/routers/category.test.ts`.** Same harness over `categoryRouter`, with `rowOf` keyed on `getTableColumns(expenseCategories)`.
  - **`list`:**
    - The left join on `expense.category = expense_category.name`, `count("expense"."id")`, `group by` id, and order by `sortOrder` then `name`.
    - A staged count `"2"` comes back as `expenseCount: 2`, which pins `mapWith(Number)`.
  - **`create`:**
    - Two queries: the `coalesce(max(...) + 1, 0)` select, then the insert. Name and description are trimmed, a blank description becomes `null`, and `sortOrder` comes from the staged max row.
    - No max row gives `sortOrder: 0`.
    - `pgError("23505")` → `CONFLICT` "A category with that name already exists." with a cause.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to create category.".
  - **`update`:**
    - A missing id → `NOT_FOUND` "Category not found." after one select, with no `begin`.
    - The same name → `begin`, the category update, `commit`. No expense update.
    - A new name → `begin`, then `update "expense" set "category" = $new where "category" = $old`, then the category update, then `commit`.
    - `23505` on the category update → `rollback`, then `CONFLICT` with the same message.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to update category.".
  - **`reorder`:** `ids: [3, 1, 2]` → `begin`, three updates setting `sortOrder` 0, 1, 2 by id, `commit`. Returns `{ success: true }`.
  - **`delete`:**
    - A missing id → `NOT_FOUND`.
    - A count of 1 → `CONFLICT` `Cannot delete "Food" — 1 expense still use it.`, with no delete query.
    - A count of 2 → "2 expenses still use it.".
    - A count of 0 → the delete SQL, and `{ success: true }`.
  - **Signed out:** `UNAUTHORIZED` with zero queries.

### Success

- [x] `make check` passes
- [x] `make test` passes against the unchanged `expense.ts` and `category.ts`
- [x] The diff touches only `recording-db.fake.ts` and the two new test files

## Phase 2: Migrate expenses and categories (two commits)

### Changes

- **`src/domain/expenses/expense.dto.ts` exports inferred input types:**
  - `ExpenseCreateInput` (`:48-50`)
  - `ExpenseUpdateInput` (`:55-57`)

  `src/domain/expenses/index.ts` re-exports them.
- **`src/domain/categories/category.dto.ts` exports inferred input types:**
  - `CategoryCreateInput` (`:8-10`)
  - `CategoryUpdateInput` (`:12-15`)
  - `CategoryReorderInput` (`:18-20`)

  `src/domain/categories/index.ts` re-exports them.
- **New `src/server/expenses/expenses.repository.ts`:** `interface ExpensesRepository` + `class DrizzleExpensesRepository`.
  - `db` is typed `typeof realDb`, as in `transactions.repository.ts:59-68`. It touches only `expenses` and `expenseCategories`, both owned by this domain.
  - No try/catch, no logging.
  - Each method lifts today's query verbatim, so the Phase 1 snapshots do not move:

    | Method | Lifted from |
    | --- | --- |
    | `list()` | `expense.ts:14-21` |
    | `insert(values)` | `expense.ts:32` |
    | `update(id, values)` | `expense.ts:40-44` |
    | `delete(id)` | `expense.ts:51` |
    | `listCategories()` | `category.ts:18-31`, with the `expenseCount` join |
    | `nextCategorySortOrder()` | `category.ts:40-47`. Returns `next?.sortOrder ?? 0` |
    | `insertCategory(values)` | `category.ts:55-58` |
    | `findCategory(id)` | `category.ts:78-81` (same as `:141-144`) |
    | `updateCategory(id, values, previousName)` | `category.ts:95-108`, one transaction. It rewrites `expense.category` only when `values.name !== previousName`. Comment: an Expense files its category by name text, so a rename must move them in the same commit. |
    | `reorderCategories(ids)` | `category.ts:127-134` |
    | `countExpensesInCategory(name)` | `category.ts:152-156`. Returns `countRow?.count ?? 0` |
    | `deleteCategory(id)` | `category.ts:167-169` |
- **New `src/server/expenses/expenses.repository.test.ts`.**
  - It calls each method directly over `recordingDb()`.
  - Each method gets the SQL and params inline snapshot its procedure had in Phase 1, copied unchanged.
  - Rename and reorder pin `begin` / `commit`. A driver error inside `updateCategory` pins `rollback` and bubbles.
- **New `src/server/expenses/expenses.service.ts`:** `ExpensesService`, with `interface ExpensesServiceDeps { repository: ExpensesRepository }`.
  - **Messages** are constants:
    - `CATEGORY_NAME_TAKEN_MESSAGE` (from `category.ts:65`)
    - `CATEGORY_NOT_FOUND_MESSAGE` (`:85`)
    - `categoryInUseMessage(name, count)` (`:161-163`, the text unchanged)
  - **A local `rethrowNameTaken(error): never`.** `isPgViolation(error, PgViolation.UniqueViolation)` → `ConflictError(CATEGORY_NAME_TAKEN_MESSAGE, { cause })`. Anything else is rethrown unchanged. It mirrors `fk-conflict.ts:6-11` and stays local because only this service needs it today.
  - **Expense methods:**
    - `list()` passes through.
    - `create(input)` returns through `assertRow(row, "create expense")`.
    - `update({ id, ...values })` returns through `assertRow(row, "update expense")`. It stays a plain `Error`, as today.
    - `delete(id)` returns `void`.
  - **Category methods:**
    - `listCategories()` passes through.
    - `createCategory(input)` trims the name, turns a blank description into `null`, takes `sortOrder` from `nextCategorySortOrder()`, inserts with `.catch(rethrowNameTaken)` and returns through `assertRow(row, "create category")`.
    - `updateCategory({ id, name, description })` finds the category and throws `NotFoundError(CATEGORY_NOT_FOUND_MESSAGE)` if it is missing. It trims the same way, calls `updateCategory(id, values, existing.name)` with `.catch(rethrowNameTaken)`, and returns through `assertRow(row, "update category")`.
    - `reorderCategories(ids)` returns `void`.
    - `deleteCategory(id)` finds the category or throws `NotFoundError`. It counts the expenses using it, and if any do, throws `ConflictError(categoryInUseMessage(...))` with no cause. Otherwise it deletes.
  - No method takes `memberId`, because none reads it (design § Only where used).
- **New `src/server/expenses/expenses.service.test.ts`.** It uses an object-literal `ExpensesRepository` fake with an `unstaged` default, as in `transactions.service.test.ts:19-35`, plus the same drizzle-wrapped `pgError` (`:12-17`).
  - `createCategory` trims, nulls a blank description, and uses the next sort order.
  - A 23505 on `createCategory` and on `updateCategory` → `ConflictError` with the message and cause. A 23503 is rethrown as the same reference.
  - A missing category on `updateCategory` → `NotFoundError`, and the repository's `updateCategory` is never called. The same holds for `deleteCategory` and its count.
  - `updateCategory` hands the repository the existing name as `previousName`.
  - `deleteCategory` with a count of 1 or 2 → `ConflictError` with the singular or plural message and no cause. Nothing is deleted. A count of 0 deletes by id.
  - An empty `insert`, `update`, `insertCategory` or `updateCategory` → a plain `Error` "Failed to <op>.".
  - Reads return the repository's result.
- **New `src/server/expenses/expenses.trpc.controller.ts`:** `export const expenseRouter = createTRPCRouter({ … })`.
  - `list`, `create`, `update` and `delete` each make one `ctx.services.expenses.<method>(…)` call.
  - `consumption` keeps `ctx.services.transactions.consumedByExpense()` and the adr022 comment from `expense.ts:24`.
  - The same DTOs, and the inline `delete` input from `expense.ts:49`. `delete` awaits the call and returns `{ success: true }`.
- **New `src/server/expenses/categories.trpc.controller.ts`:** `export const categoryRouter`.
  - `list` → `listCategories`, `create` → `createCategory`, `update` → `updateCategory`.
  - `reorder` → `reorderCategories(input.ids)`, then returns `{ success: true }`.
  - `delete` → `deleteCategory(input.id)`, then returns `{ success: true }`, with the inline input from `category.ts:139`.
  - No Drizzle, no try/catch.
- **New `src/server/expenses/expenses.trpc.controller.test.ts` and `categories.trpc.controller.test.ts`.** They use `createTestCaller` with `Partial<ExpensesService>` (and, for `consumption`, `Partial<TransactionsService>`) fakes, plus the `recorder` helper from `transactions.trpc.controller.test.ts:19-26`.
  - Each procedure calls its method with the parsed input.
  - `delete` and `reorder` return `{ success: true }`.
  - `expense.consumption` calls the transactions fake, not the expenses fake.
  - A fake that throws `NotFoundError` surfaces as `NOT_FOUND`, and `ConflictError` as `CONFLICT`, through the real middleware.
  - A signed-out call → `UNAUTHORIZED`, and the fake is never called.
- `src/server/api/services.ts` — add `expenses: new ExpensesService({ repository: new DrizzleExpensesRepository({ db }) })`.
- `src/server/api/root.ts:4-5` — import `categoryRouter` from `~/server/expenses/categories.trpc.controller` and `expenseRouter` from `~/server/expenses/expenses.trpc.controller`. The keys (`:21-22`) do not change.
- **Commit A: the proof.**
  - Point `expense.test.ts` and `category.test.ts` at the new routers through `createTestCaller`.
  - Use `services: { expenses: new ExpensesService({ repository: new DrizzleExpensesRepository({ db: recordingDb().db as never }) }) }` and no `ctx.db`.
  - Every inline snapshot and assertion stays byte-identical and green.
- **Commit B: remove the routers.**
  - Delete `src/server/api/routers/expense.ts`, `category.ts`, `expense.test.ts` and `category.test.ts`.
  - The characterization cases now live elsewhere:
    - SQL goes to `expenses.repository.test.ts`.
    - Codes and messages go to `expenses.service.test.ts` and the two controller tests.
- **`src/server/architecture.test.ts` to-do list.** Delete the 5 `routers/category.ts` and `routers/expense.ts` entries (`:54-58`). The list goes from 32 to 27.
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — this phase implements this decision for expenses and categories: two tRPC controllers over one service.

### Success

- [ ] `make check` passes
- [ ] `make test` passes, and Commit A is green with no snapshot change
- [ ] `make build` passes
- [ ] `git grep -n "ctx.db\|drizzle-orm\|TRPCError" src/server/expenses/expenses.service.ts src/server/expenses/*.trpc.controller.ts` returns nothing
- [ ] `src/server/api/routers/expense.ts` and `category.ts` no longer exist, and the to-do list has 27 entries
- [ ] At https://personal-finance.localhost, these behave as before:
  - the Planned page: the Expense list, create, edit, delete, and Consumed / Remaining
  - the Categories page: the list with its expense counts, create, and drag-to-reorder (the order survives a reload)
  - renaming an Expense Category moves its Expenses to the new name
  - a duplicate name shows "A category with that name already exists."
  - deleting a category in use shows the "still use it" message, and deleting an empty one works

## Phase 3: Transaction list names through the expenses service

### Changes

- **`src/server/expenses/expenses.repository.ts` — two lookups by id.**
  - `findExpenseNames(ids)` selects `id` and `name` from `expenses` where `inArray(expenses.id, ids)`.
  - `findCategoryNames(ids)` does the same on `expenseCategories`.
  - Both return `{ id: number; name: string }[]`.
- `src/server/expenses/expenses.repository.test.ts` — an SQL and params snapshot for each lookup.
- **`src/server/expenses/expenses.service.ts` — `namesByIds({ expenseIds, categoryIds }): Promise<NamesById>`.**
  - `export interface NamesById { expenses: ReadonlyMap<number, string>; categories: ReadonlyMap<number, string> }`.
  - It runs both lookups in `Promise.all` and skips a lookup when its id list is empty, so there is no query for nothing.
  - Comment: the batched lookup that replaces a cross-domain join (adr022). One call per page, never per row.
- **`src/server/expenses/expenses.service.test.ts`:**
  - Rows become the two maps.
  - An empty id list never calls its repository method.
  - A lookup error propagates.
- **`src/server/transactions/transactions.repository.ts` — the join goes.**
  - `list` (`:104-120`) selects `getTableColumns(transactions)` only and drops both `leftJoin`s.
  - Drop the `expenseCategories` and `expenses` imports (`:32-33`).
  - The interface (`:37`) and method return `TransactionPage = { items: Transaction[]; total: number }`, exported from the repository file.
  - The count query, filters and sorting do not change.
- **`src/server/transactions/transactions.repository.test.ts`:**
  - `LIST_FIELDS` (`:25`) goes away, and the list cases use `COLUMNS`.
  - The default case's name (`:84`) drops "over two left joins".
  - Its snapshot loses only the two `left join`s and the `"expense"."name"` / `"expense_category"."name"` columns. That is the only intended snapshot diff in this phase.
  - The filter, sort and paging cases (`:115-292`) keep their snapshots.
- **`src/server/transactions/transactions.service.ts` — `list` merges the names.**
  - `TransactionsServiceDeps` adds `expenses: Pick<ExpensesService, "namesByIds">`, a type-only import from `~/server/expenses/expenses.service`.
  - `list(query)` gets the page from the repository. It collects the distinct non-null `expenseId`s and `expenseCategoryId`s and makes one `namesByIds` call.
  - It maps each row to `{ ...row, expenseName, expenseCategoryName }`. A null id, or an id missing from the map, gives `null`, which keeps the left-join semantics.
  - `total` passes through.
- **`src/server/transactions/transactions.service.test.ts`.** `serviceWith` (`:23-35`) also takes an `expenses` fake, with an `unstaged` default. The list case at `:213-231` is replaced by:
  - It merges the names onto each row and passes `total` through.
  - It asks once, with distinct ids. Two rows on Expense 7 → `expenseIds: [7]`.
  - A null link gives a null name, and that id is never asked for.
  - An id with no name, because the row was deleted between the reads, gives `null`.
  - An error from `namesByIds` propagates.
- **`src/server/api/services.ts`.** Build `expenses` first, as a `const`, and pass it to `TransactionsService` as `expenses`. Both keys stay on `services`.
- `src/domain/transactions/transaction.interface.ts:25-26` — the comment now says the names come from the expenses service by id, and are null when unlinked or when the row is gone. The shape does not change.
- **`src/server/architecture.test.ts` to-do list.** Delete the two rule-1 `transactions.repository.ts` entries (`:41-42`). The list goes from 27 to 25.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — this phase implements this decision for the transaction list. The join becomes a batched lookup through the owning service.

### Success

- [ ] `make check` passes
- [ ] `make test` passes, and the only changed snapshot is the default list case's dropped joins and name columns
- [ ] `make build` passes
- [ ] `git grep -n "server/expenses" src/server/transactions/transactions.repository.ts` returns nothing, and the to-do list has 25 entries
- [ ] At https://personal-finance.localhost, the Transactions list behaves as before:
  - linked rows show their Expense and Expense Category names
  - unlinked rows show none
  - search, filters, sort and paging are unchanged

## Phase 4: Docs

### Changes

- **`.claude/rules/server-architecture.md`:**
  - Intro (`:18`) — add `src/server/expenses/` as the example of two tRPC controllers (`expenses`, `categories`) over one service.
  - Tests (`:110-115`) — note that `recordingDb()` supports `db.transaction(cb)` and records `begin` / `commit` / `rollback`.
  - tRPC routers (not yet migrated) (`:140`) — the list becomes `allowedSender, balance, cashflow, income, receipt, setting`. `category` and `expense` come from `src/server/expenses/`, and `transaction` from `src/server/transactions/`.
  - Schema homes (`:162-163`) — name `TransactionsService.list` → `ExpensesService.namesByIds` as the batched-lookup example: one call per page, merged in memory, null for a missing id.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80-81` Implementation status:**
  - "Done" adds `src/server/expenses/`: `expenses.trpc.controller.ts` and `categories.trpc.controller.ts` → `ExpensesService` → `ExpensesRepository` / `DrizzleExpensesRepository`. It also notes that the transaction list's names come through `ExpensesService.namesByIds`.
  - "Next" becomes income, then balances, then settings (step 3).

### Success

- [ ] `make check` passes
- [ ] Every path named in the edited rules-file sections exists (`git ls-files` check)
- [ ] The rules file names no `routers/expense.ts` or `routers/category.ts`

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md` (§ Migration step 2, § Router map, § Replacing a join; carries `## Related ADRs`)
- ADRs:
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phase 2
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — implemented by Phase 3. Phase 2 clears its router to-do entries.
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted) — refined, and its Implementation status is updated in Phase 4
- Prior plan: `thoughts/plans/2026-09-29-trpc-3-tier-step-1-foundation-transactions.md` (the two-commit migration shape, `recordingDb`, `createTestCaller`)
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md` — **Expense** (`:28`), **Expense Category** (`:62`), **Group** (`:96`)
- Related:
  - `src/server/api/routers/expense.ts:12-54`, `src/server/api/routers/category.ts:16-172` (deleted in Phase 2)
  - `src/server/transactions/transactions.repository.ts:104-120`, `src/server/transactions/transactions.service.ts:36-38`
  - `src/server/db/recording-db.fake.ts:17-27`
  - `src/server/architecture.test.ts:38-70`
