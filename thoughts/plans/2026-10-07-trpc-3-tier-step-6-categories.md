---
date: 2026-10-07
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022, adr023, adr024, adr025]
status: Ready to implement
---
# tRPC 3-tier migration, step 6: categories — Implementation Plan

## Context

Steps 1–5 shipped. Categories still live inside `expenses/`. An Expense links to its Category by **name text**, so a rename has to rewrite every Expense, and nothing stops an Expense from pointing at a missing Category. The names also disagree with the glossary: the table is `expense_category`, and a Transaction's Group column is called `category`. This is migration step 6 of the design (`:820-834`). It ships as three commits:
- **A:** fix the data and the names.
- **B:** move Categories into their own domain (adr024, adr023).
- **C:** a linked Expense sets a Transaction's Category (adr025).

The tRPC paths, the Categories page and its route do not change.

## Current State

- **Schema.**
  - `src/server/expenses/categories.schema.ts:3-13`:
    - `expenseCategories = pgTable("expense_category", …)`, with `name` unique.
    - `createdAt` has only `$defaultFn` (`:8-11`) and no database default. Hand-written SQL inserts must supply `now()`.
  - `src/server/expenses/expenses.schema.ts:12`: `category: d.text().notNull()`. No indexes, no FKs.
  - `src/server/transactions/transactions.schema.ts`:
    - `expenseCategoryId` FK, `set null` (`:22-24`).
    - `category` text, default `"Uncategorised"` (`:29`). This is the Group.
    - Index `transaction_expense_category_idx` (`:43`).
  - `src/server/receipts/receipts.schema.ts:83-85`: `receipt_item.expenseCategoryId` FK, `set null`.
  - Names in the latest snapshot (`drizzle/meta/0011_snapshot.json`):
    - `expense_category_name_unique`
    - `expense_category_id_seq`
    - `transaction_expenseCategoryId_expense_category_id_fk`
    - `receipt_item_expenseCategoryId_expense_category_id_fk`
  - Migrations `0000`–`0011` have no `check()` and no `restrict`.
  - `0008` is the precedent for a rename with rollback notes. `0002` is the precedent for a generated file that was edited by hand.
- **drizzle-kit facts.**
  - `generate --custom` writes an empty SQL file and **copies the previous snapshot** (`node_modules/drizzle-kit/bin.cjs:19841-19846`). A schema change made inside a custom file never reaches a snapshot, so the next `generate` would emit it again. A custom file must hold data changes only.
  - Rename prompts need a TTY.
  - A change to an identity's sequence name emits no SQL (`bin.cjs:23520-23560` only alters type, min, max, increment, start, cache and cycle). The rename has to be added by hand.
  - `migrate` runs every pending file in one transaction (`node_modules/drizzle-orm/pg-core/dialect.js:60-63`).
  - CI runs `make db_check`, then `make db_migrate` (`.github/workflows/deploy.yml:196-209`).
  - The Makefile targets are `db_generate` (`:59`), `db_custom name=` (`:62-63`), `db_migrate` (`:65`) and `db_check` (`:71`). The Neon branch targets are `db_branch`, `db_branch_delete` and `db_branch_status` (`:74-84`).
  - `scripts/neon-branch.sh:161-223` (`create`) branches from prod, points `.env` at the new branch and runs `db:migrate` (`:221`).
- **Server, `src/server/expenses/`** (the step-2 shape: two controllers over one service).
  - `ExpensesService` (`expenses.service.ts`):
    - Category copy: `CATEGORY_NAME_TAKEN_MESSAGE` `:20`, `CATEGORY_NOT_FOUND_MESSAGE` `:21`, `categoryInUseMessage` `:22-23`.
    - `rethrowNameTaken` `:27-32`, `normalizeCategory` `:34-39`.
    - `NamesById` `:42-45`.
    - Category methods: `listCategories` `:81`, `createCategory` `:85-91`, `updateCategory` `:93-102`, `reorderCategories` `:104`, `deleteCategory` `:108-115` (counts first, then throws the count message).
    - `namesByIds({expenseIds, categoryIds})` `:119-134`.
    - `findCategoryOrThrow` `:136-140`.
  - `expenses.repository.ts`:
    - `list` orders by `category, sortOrder, name` (`:63-71`).
    - `listCategories` left-joins Expenses **on name** and counts them (`:95-110`).
    - `updateCategory` runs a transaction that rewrites `expense.category` when the name changes (`:143-164`, rewrite at `:151-156`).
    - `countExpensesInCategory(name)` `:177-183`.
    - `findExpenseNames` `:189-194`, `findCategoryNames` `:196-201`.
  - `categories.trpc.controller.ts:9-35`: `categoryRouter`. Every procedure calls `ctx.services.expenses.*Category*`.
- **Server, transactions.**
  - `transactions.service.ts`:
    - The deps take one `expenses: Pick<ExpensesService,"namesByIds">` port (`:33-45`).
    - `list` sets `expenseName` and `expenseCategoryName` from one `namesByIds` call (`:47-61`).
    - `create` and `update` use `rethrowFkConflict` (`:67-85`). `linkExpense` → `setExpense` (`:92-100`).
  - `transactions.repository.ts`:
    - The Group is used by search (`:81`), filter (`:89`), the sort map (`:102`), `topCategories` (`:163-172`) and `findUnplanned`'s first order key (`:222`).
    - `setExpense` writes only `expenseId` (`:230-240`).
- **Server, receipts.**
  - The `src/server/api/routers/receipts.ts` router (migrates in step 7):
    - `get` left-joins `expenseCategories` for `expenseCategoryName` (`:129-145`). No test covers `get`.
    - `setItemCategory` writes `{ expenseCategoryId }` (`:335-355`). Its test is `receipts.match.test.ts:144-160`.
  - The worker:
    - `receipts.repository.ts:5,34-35,98-102` (`listExpenseCategories`).
    - `receipts.service.ts` prompt `:180-195`, the call at `:391`, the unknown-id guard at `:395-411`.
    - `receipt-extraction.dto.ts:16`: the `expenseCategoryId` key is the wire contract with the model (`generateObject`, `receipts.service.ts:441`).
  - Old `receipt.rawJson` holds `expenseCategoryId`, but it is only displayed (`more-details.display.ts:70,77-80`) and never parsed again. No backfill.
  - No raw `sql` uses the old names.
- **Domain kernel.**
  - `src/domain/expenses/expense.dto.ts:8`: `category: z.string().trim().min(1)`. `expense.interface.ts:6`.
  - `src/domain/transactions/transaction.dto.ts`:
    - sortBy `"category"` `:12`, filter `category` `:20`, field `category` `:35`, `expenseCategoryId` `:40`.
    - `linkExpenseDto` `:73-76`.
  - `transaction.interface.ts`: `category` `:6`, `expenseCategoryId` `:11`, `expenseCategoryName` `:29`, `topCategories` `:59-63`.
  - `src/domain/categories/category.interface.ts:8`: `expenseCount?`.
  - `src/domain/receipts/receipt.dto.ts:42`, `receipt.interface.ts:28,41,56`.
- **Wiring.**
  - `src/server/api/services.ts`: there is no `categories` key. `transactions` gets `{ repository, expenses }` (`:39-42`).
  - `src/server/api/root.ts:6,17`: `category` is served from `expenses/`.
  - `src/server/db/index.ts:8,20`.
  - `src/server/db/schema-interface-contract.test.ts:14,31-33`: `Omit<Category,"expenseCount">`.
- **The architecture to-do list** (`src/server/architecture.test.ts:38-49`) has 10 entries. Two of them name `~/server/expenses/categories.schema`: `:40` (the worker repository) and `:43` (`routers/receipts.ts`).
- **Client.**
  - **Expenses page** (`expenses-view.tsx`):
    - Ranks groups by name (`:29-35`) and groups by `item.category` (`:36-45`).
    - `category.list` is a plain `useQuery` (`:51`).
    - Group keys and collapse keys are names (`:270-291,360-390`).
  - **Expense form** (`expense-form.tsx`):
    - Falls back to `EXPENSE_CATEGORIES` (`src/lib/constants.ts:62-68`, used nowhere else) and defaults to its second entry (`:23,64-69,87`).
    - Submits `category` text (`:143,153`). The select is at `:190-200`.
  - **Unplanned page** (`unplanned-view.tsx:99-115`): groups by the Group text and ranks by matching it to managed Category names.
  - **Transactions page.**
    - `transactions-view.tsx`:
      - Feeds managed Category **names** into the Group combobox (`:69-75`, `:381`).
      - Sorts by `"category"` (`:34,119,237`), searches "description, category or notes" (`:190`), and shows `tx.category` and `tx.expenseCategoryName` (`:279-282`).
    - `transaction-form.tsx`:
      - The Group combobox is labelled "Category" (`:202-232`), with option injection at `:115-120`.
      - The "Expense category" select is at `:235-245`.
      - The submit is at `:138-148`, and blank saves `"Uncategorised"` (`:142`).
  - **Dashboard.** "Top categories" (`(dashboard)/page.tsx:174,179`, `_components/top-categories.tsx:6,12,21,24`).
  - **Categories page** (`categories-view.tsx`):
    - Description "Organise your budgeted expenses into categories." (`:71`). Title "Expense Categories" (`:72`).
    - Shows the `expenseCount` badge (`:94-97`).
  - **Category form** (`category-form.tsx`): its success handler also invalidates `expense.list` (`:35-39`). Dialog copy "Categories group your budgeted expenses." (`:68`).
  - **Receipt detail** (`receipt-detail.tsx:419-423,453-469`): the item Category picker.
- **Docs that go stale.**
  - `.claude/rules/server-architecture.md:18-19,154-155,171,179-181,201`.
  - adr004 `:71,80-81`. adr005 `:35-49`. adr017 `:45`. adr024 `:64-65`. adr003 `:16,31`.
  - `.claude/rules/e2e-testing.md:11,35-36`. `.claude/skills/pull-request/SKILL.md:16`.
- **Glossary.** `CONTEXT.md` already matches adr024/adr025:
  - Category `:62-65` (avoid "expense category").
  - Group `:96-99`.
  - Planned avoids "budgeted" (`:56`).
  - Unplanned avoids "uncategorised" (`:33-36`).
  - The flagged ambiguities at `:177-190`.

## Desired End State

- **Data.**

  | Before | After |
  | --- | --- |
  | table `expense_category` | table `category` (`category_name_unique`, `category_id_seq`) |
  | `expense.category` text | `expense."categoryId"` int, not null, FK `restrict`, index `expense_category_idx` |
  | `transaction."expenseCategoryId"` | `transaction."categoryId"`, FK `set null`, index `transaction_category_idx` |
  | `transaction.category` (the Group) | `transaction."group"`, same default |
  | `receipt_item."expenseCategoryId"` | `receipt_item."categoryId"`, FK `set null` |

  - Every Expense has a `categoryId`. A "Needs refiling" Category exists only if some Expense name matched no Category.
  - `transaction` has the check `"expenseId" IS NULL OR "categoryId" IS NULL`.
  - Old `receipt.rawJson` is untouched.
- **Code.**
  - `src/server/categories/` holds:
    - `categories.schema.ts` (export `categories`)
    - `categories.repository.ts`
    - `categories.service.ts` (`CategoriesService`: `list`, `create`, `update`, `reorder`, `delete`, `namesByIds`)
    - `categories.trpc.controller.ts`
    - a test for each
  - `expenses/` holds only Expense code. `ExpensesService` has no Category methods. Its `namesByIds(ids)` returns Expense names and their `categoryId`. It adds `countsByCategory()`, served as `expense.countsByCategory`.
  - `TransactionsService` takes `expenses` and `categories` ports.
    - `list` makes two batched calls, one after the other. `categoryName` is the **effective Category**.
    - Linking an Expense clears `categoryId`. Unlinking copies the Expense's Category back.
  - The to-do list still has 10 entries. Two of them now name `~/server/categories/categories.schema`.
- **Member-facing.**
  - **Category rename.** It writes one row.
  - **Category delete.**
    - Blocked while Expenses use it, with `Cannot delete "X" — expenses still use it.`
    - Transactions and receipt items filed under it lose the link (`set null`), with no warning.
  - **Expense form.** The Category picker lists managed Categories by id, with no default. A Category is required.
  - **Expenses page.** Grouped by Category id, in managed order.
  - **Unplanned page.** Grouped by the Transaction's Category, in managed order. A last "No category" group holds the rest.
  - **Transactions page.**
    - The Group column is headed "Group". The search hint says "group".
    - The form has a plain "Group" text input (blank saves "Uncategorised") and a "Category" picker. The picker is read-only and shows the Expense's Category while an Expense is linked.
  - **Dashboard.** "Top groups".
  - **Categories page.**
    - Title "Categories", with a new description.
    - Counts come from `expense.countsByCategory`.
- `make check`, `make test` and `make build` are green.

## Out of Scope

- **Step 7.** All of these wait:
  - the receipts router migration
  - the worker reading Categories through `CategoriesService` (adr024 `:74`)
  - the line-item check constraint and the link and unlink rules for line items (adr025 `:51`)
  - "Attribute to" and hint copy in `receipt-detail.tsx:405,489-491`
  - every `*.module.ts`
- **Step 8.** Removing `ctx.db`, and the rewrite of the rules-file router section.
- **Dropping the Group column.** Also: opt-in includes, published views, and a filter or sort on the effective Category.
- **Any tRPC path change.** `category.*` stays `category.*`.
- **Re-parsing old `receipt.rawJson`.**
- **Changing any ADR `Status:`.** adr021–adr025 stay Proposed.

## Approach

Four phases. A pre-flight measures prod. Then Commits A, B and C, each green on its own.

- **Pre-flight.** A fresh Neon branch of prod gives the orphan and disagreement counts. They go into the migration headers. The SQL handles either outcome.
- **Commit A** changes the data and names but keeps the domain layout.
  - Its migration is **three files**: a generated rename, a custom backfill, then a generated not-null and drop. Splitting them keeps every schema change in a snapshot. A single custom file would leave the next `generate` re-emitting the whole change.
  - All three run in one `make db_migrate` transaction.
  - Existing repository SQL snapshots and service tests characterize every server path. One new test characterizes `receipt.get`, the only renamed path with no test.
- **Commit B** is a pure move. The categories controller test stays byte-identical apart from its import and service key. That proves the paths and responses held.
- **Commit C** is a feature commit. It has its own two-file migration (a custom clear, then a generated check) and is built by the TDD vertical-slice loop (`tdd` skill).

## Phase 1: Pre-flight on a fresh copy of prod

No code, no commit.

### Changes

- `make db_branch_delete`, then `make db_branch`. This gives a fresh branch of prod at migration `0011`. It is the same flow as `scripts/neon-branch.sh:161-223`.
- In the Neon console SQL editor, on the `local/<git-branch>` branch, run:

  ```sql
  -- Orphans: Expenses whose name text matches no Category.
  SELECT e."category", count(*) FROM "expense" e
  LEFT JOIN "expense_category" c ON c."name" = e."category"
  WHERE c."id" IS NULL GROUP BY 1;

  -- Commit C: linked Transactions whose own Category disagrees with their Expense's.
  SELECT count(*) FILTER (WHERE t."expenseCategoryId" IS NOT NULL) AS linked_with_own,
         count(*) FILTER (WHERE t."expenseCategoryId" IS DISTINCT FROM c."id"
                            AND t."expenseCategoryId" IS NOT NULL) AS disagree
  FROM "transaction" t JOIN "expense" e ON e."id" = t."expenseId"
  LEFT JOIN "expense_category" c ON c."name" = e."category";

  -- Step 7 baseline, the same query for receipt_item.
  SELECT count(*) FILTER (WHERE r."expenseCategoryId" IS NOT NULL) AS linked_with_own
  FROM "receipt_item" r WHERE r."expenseId" IS NOT NULL;

  -- The identity sequence name the hand-written rename assumes.
  SELECT pg_get_serial_sequence('"expense_category"', 'id');
  ```
- Note the four results for the migration headers in Phases 2 and 4.

### Results (2026-10-07)

- Orphans: none. "Needs refiling" will not be created.
- Linked Transactions: `linked_with_own` 1, `disagree` 0.
- `receipt_item` baseline: `linked_with_own` 0.
- Sequence: `public.expense_category_id_seq`.

### Success

- [x] The orphan names and their counts are recorded
- [x] The `disagree` count is recorded
- [x] The `receipt_item` baseline is recorded
- [x] `pg_get_serial_sequence` returns `public.expense_category_id_seq`

## Phase 2: Commit A — data and names

Two commits: a characterize commit, then Commit A. Implements the data half of adr024.

### Changes

**Commit A0: characterize `receipt.get`**

- **New `src/server/api/routers/receipts.get.test.ts`.**
  - Mocks: copy the four from `receipts.match.test.ts:5-8`, and mock `~/env` as `src/app/api/receipts/inbound/route.test.ts:16`. Use the `caller(db)` shape from `receipts.match.test.ts:17-23`.
  - `db` comes from `recordingDb` (`src/server/db/recording-db.fake.ts`). Match on `query.sql`: `from "receipt" left join` returns the receipt, and `from "receipt_item"` returns items.
  - Cases:
    - Pin both selects in `toMatchInlineSnapshot`.
    - An item with a Category row returns its `expenseCategoryName`.
    - An item with no Category returns `null`.
    - A missing receipt → `NOT_FOUND`.

**Commit A: migration**

1. **Intermediate schema, for file A1 only.**
   - `src/server/expenses/categories.schema.ts`:
     - Export `categories = pgTable("category", …)`.
     - Add a header comment: a Category files Expenses, Transactions and receipt items.
   - `src/server/expenses/expenses.schema.ts`:
     - Import `categories` from `./categories.schema`.
     - Keep `category` text for now.
     - Add `categoryId: d.integer().references(() => categories.id, { onDelete: "restrict" })`. It is **nullable** in this step.
     - Add the extra-config array `(t) => [index("expense_category_idx").on(t.categoryId)]`.
   - `src/server/transactions/transactions.schema.ts`:
     - `expenseCategoryId` → `categoryId`. Its FK points to `categories.id`, `set null`.
     - `category` → `group`, same default.
     - Index `:43` becomes `index("transaction_category_idx").on(t.categoryId)`.
   - `src/server/receipts/receipts.schema.ts`:
     - `:10` imports `categories`.
     - `:83-85` `expenseCategoryId` → `categoryId`.
2. **Sam runs `make db_generate` in a terminal** (the prompts need a TTY). Answers:
   - table `category` → **rename** from `expense_category`
   - `transaction.categoryId` → **rename** from `expenseCategoryId`
   - `transaction.group` → **rename** from `category`
   - `receipt_item.categoryId` → **rename** from `expenseCategoryId`
   - `expense` gets no prompt, because nothing is dropped there.
3. **Check file A1** (`drizzle/0012_*.sql`). It must hold:
   - `RENAME TO "category"`
   - three `RENAME COLUMN`
   - drop and add for the two renamed FKs, `category_name_unique` and the transaction index
   - add `expense."categoryId"`, `expense_category_idx`, and FK `expense_categoryId_category_id_fk` `ON DELETE restrict`

   It must hold **no** `DROP COLUMN`. Then edit it by hand:
   - Prepend `ALTER SEQUENCE "expense_category_id_seq" RENAME TO "category_id_seq";--> statement-breakpoint`. drizzle-kit emits nothing for a sequence rename (`bin.cjs:23520-23560`), but the snapshot now says `category_id_seq`.
   - Add a rollback header in `0008`'s style: the reverse renames, `DROP` the new column, FK and index.
4. **`make db_custom name=backfill_expense_category_id`** → file A2. Contents:

   ```sql
   -- Pre-flight (<date>): <n> orphan names: <list>. Rollback: nothing to undo
   -- beyond A1's; the Needs refiling row can be deleted once Expenses move off it.
   UPDATE "expense" e SET "categoryId" = c."id" FROM "category" c WHERE c."name" = e."category";--> statement-breakpoint
   INSERT INTO "category" ("name", "description", "sortOrder", "createdAt")
   SELECT 'Needs refiling', 'Expenses whose category name matched no Category during the step 6 migration.',
          (SELECT coalesce(max("sortOrder") + 1, 0) FROM "category"), now()
   WHERE EXISTS (SELECT 1 FROM "expense" WHERE "categoryId" IS NULL)
   ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
   UPDATE "expense" SET "categoryId" = (SELECT "id" FROM "category" WHERE "name" = 'Needs refiling')
   WHERE "categoryId" IS NULL;
   ```

   - The match is exact, like today's join (`expenses.repository.ts:107`).
   - `createdAt` needs `now()`, because the column has no database default.
5. **Final schema.** In `expenses.schema.ts`:
   - `categoryId` gets `.notNull()`.
   - Delete `category` (`:12`).
6. **`make db_generate`** → file A3. It holds only `ALTER COLUMN "categoryId" SET NOT NULL` and `DROP COLUMN "category"`, and no prompt appears. Add a rollback header that re-adds the text column and fills it from the join.
7. **`make db_migrate`** on the Phase 1 branch. Verify in the Neon console:
   - `SELECT count(*) FROM "expense" WHERE "categoryId" IS NULL` returns 0.
   - "Needs refiling" exists if, and only if, Phase 1 found orphans.
   - `pg_get_serial_sequence('"category"','id')` = `public.category_id_seq`.
   - Inserting a test Category takes the next id after the max (then delete the row).
   - The constraint and index names match `drizzle/meta/0014_snapshot.json`.

**Commit A: server (still inside `expenses/`)**

- **`src/server/expenses/expenses.repository.ts`**
  - Import `categories` (`:9`). Rename every `expenseCategories` to `categories`.
  - `list` orders by `categoryId, sortOrder, name` (`:63-71`).
  - `listCategories` joins `eq(expenses.categoryId, categories.id)` (`:107`).
  - `updateCategory` becomes one `update … returning`, with no transaction and no `previousName` argument. Delete the rewrite at `:151-156`.
  - `countExpensesInCategory(categoryId: number)` counts `eq(expenses.categoryId, categoryId)`. Update the port (`:19-50`) to match.
- **`src/server/expenses/expenses.service.ts`**
  - `updateCategory` calls `updateCategory(id, values)` (`:97-99`).
  - `deleteCategory` counts by `existing.id` (`:110`).
  - `create` and `update` (`:65-75`) catch with `rethrowFkConflict(error, CATEGORY_GONE_MESSAGE)`, where `CATEGORY_GONE_MESSAGE = "The selected category no longer exists."`.
- **`src/server/expenses/expenses.repository.test.ts`** — update the inline snapshots:
  - the `list` order
  - the join (`:177-193`)
  - the rename case (`:314-361`) becomes one `update "category"` statement with no `update "expense"`
  - `countExpensesInCategory` (`:440,458`) takes an id
  - `findCategoryNames` (`:504`)
- **`src/server/expenses/expenses.service.test.ts`**
  - The `updateCategory` cases (`:216`) no longer pass `existing.name`.
  - `deleteCategory` (`:303`) counts by id.
  - Two new cases: an FK 23503 on `create` and on `update` gives `ConflictError` with the new message (`failedQuery`, `src/test/fakes.ts:29-33`). Any other error passes through.
- **`src/server/expenses/expenses.schema.test.ts:42-45`** — `categoryId` is not null, has no default and references `category.id` with `onDelete: "restrict"`. Read this from `getTableConfig(expenses).foreignKeys`.
- **`src/server/expenses/categories.schema.test.ts`** — the table name is `category`.
- **`src/server/expenses/expenses.trpc.controller.test.ts:30,44`** — fixtures use `categoryId: 3`.
- **`src/server/transactions/transactions.repository.ts`**
  - `category` → `group`: search `:81`, filter `:89`, the sort map `:102`.
  - `topCategories` → `topGroups`, selecting `{ group, total, count }` (`:129,163-172,181`).
  - `findUnplanned` orders by `categoryId`, then `date` desc, then `id` desc (`:222`). The page groups by `categoryId`. Fix the comment at `:220-221` to say "same-Category".
- **`src/server/transactions/transactions.service.ts`**
  - The `:18` comment names `categoryId`.
  - `list` passes `categoryIds` from `row.categoryId` and sets `categoryName` (`:51,57`).
- **`src/server/transactions/*.test.ts`**
  - Rename the old names in the repository snapshots (`:91,160,166,222,230,272,328,373,420,454,479`).
  - The filter case (`:137`) and sort case (`:257,272`) use `group`.
  - The topGroups case is at `:302,328`.
  - Service fixtures (`:44-58,228-239`) and controller fixtures (`:23,28,61`).
  - `transactions.schema.test.ts:9-11` tests the `group` default.
- **`src/server/api/routers/receipts.ts`**
  - Import `categories` (`:36`).
  - `get` selects `categoryName: categories.name` and joins on `receiptItems.categoryId` (`:136-142`).
  - `setItemCategory` sets `{ categoryId: input.categoryId }` (`:342`).
  - The `:46` comment names `categoryId`.
- **`src/server/api/routers/*.test.ts`**
  - `receipts.get.test.ts`: the snapshot and field rename are the only diff.
  - `receipts.match.test.ts:147-159` uses `categoryId`.
- **The receipts worker**
  - `receipts.repository.ts`:
    - `listExpenseCategories` → `listCategories` (`:34-35,98-102`).
    - `ReceiptItemInsert` gets `categoryId` (`:14-18`).
    - `saveExtraction` (`:116-117`).
  - `receipts.service.ts`:
    - The prompt prose says `categoryId` (`:181,194`).
    - The call at `:391`.
    - The guard at `:405-408`.
  - Tests: `receipts.repository.test.ts:4,48,157-165,181-205`, `receipts.service.test.ts:78-79,147,246-247,279-297,644` and `receipts.schema.test.ts:70-71`.
- **`src/server/db/index.ts:8`** — `import * as categoriesSchema`. **`schema-interface-contract.test.ts:14,32`** — `categories`.
- **`src/server/architecture.test.ts:40,43`** — no change. The specifier is still `~/server/expenses/categories.schema`.

**Commit A: domain kernel**

- `src/domain/expenses/expense.dto.ts:8` — `categoryId: z.number().int().positive()`. `expense.interface.ts:6` — `categoryId: number`.
- `src/domain/expenses/expense.dto.test.ts:12,25-42` — accepts a positive int, and rejects `0`, `-1`, `"3"` and a missing value. The trim cases go.
- `src/domain/transactions/transaction.dto.ts`:
  - sortBy `"group"` (`:12`).
  - The filter `group` (`:20`).
  - The field `group: z.string().trim().min(1, "Group is required").optional()` (`:35`).
  - `categoryId` (`:40`).
- `transaction.interface.ts`:
  - `group` (`:6`), `categoryId` (`:11`), `categoryName` (`:29`).
  - `topGroups: { group; total; count }[]` (`:59-63`).
- `transaction.dto.test.ts:69-134` — rename the cases. The sortBy `satisfies keyof Transaction` still holds.
- `src/domain/receipts/receipt-extraction.dto.ts:16` — the key becomes `categoryId`. Rename its test (`:10-35`).
- `receipt.dto.ts:42`, `receipt.interface.ts:28,41,56` — `categoryId`, `categoryName`.
- `src/domain/categories/category.interface.ts` — no change in A.
- `src/domain/cashflow/cashflow.test.ts:39` — the fixture uses `categoryId: 1`.

**Commit A: client** — read `node_modules/next/dist/docs/` on suspense queries and prefetch before editing.

- **`src/app/(dashboard)/expenses/_components/expenses-view.tsx`**
  - `category.list` becomes `useSuspenseQuery` (`:51`). The page already prefetches it (`page.tsx:7`).
  - `makeRank` ranks by id, using the list's index (`:29-35`).
  - `groupByCategory` groups by `item.categoryId` (`:36-45`).
  - Group labels come from a `Map(id → name)`.
  - Card and collapse keys become `r:<id>` and `o:<id>` (`:272,371`).
  - Delete the branch for names with no Category row.
- **`expense-form.tsx`**
  - Drop the `EXPENSE_CATEGORIES` import and fallback (`:23,64-67`).
  - State is `categoryId: number | null`, with no default (`:69,87`).
  - Options come from `category.list` with `value: String(c.id)`.
  - The select is required and shows the placeholder "Choose a category" (`:190-200`).
  - Disable submit while `categoryId` is null.
  - The payload sends `categoryId` (`:143,153`).
- **`src/lib/constants.ts:62-68`** — delete `EXPENSE_CATEGORIES`.
- **`expenses/unplanned/_components/unplanned-view.tsx:99-115`**
  - Group by `row.categoryId` and rank by `category.list` index.
  - Collect `null` in one last group labelled "No category".
  - The header (`:219-229`) reads the name from the map.
- **`transactions/_components/transactions-view.tsx`**
  - Drop the `categories` name list and its comment (`:69-75`) and the `categories` prop (`:381`).
  - `SortBy` uses `"group"` (`:34,119`).
  - `<SortHeader col="group">Group</SortHeader>` (`:237`).
  - The placeholder reads "Search description, group or notes..." (`:190`).
  - Show `tx.group` and `tx.categoryName` (`:279-282`).
- **`transaction-form.tsx`**
  - Remove the `categories` prop and the combobox state, ref and option injection (`:57,67-77,93,115-120`).
  - The Group becomes `<Input id="tx-group">`, labelled "Group", with placeholder "e.g. Groceries" (`:202-232`). Blank still saves `"Uncategorised"` (`:142`).
  - The "Expense category" select becomes "Category", `id="tx-category"` (`:235-245`), with state `categoryId` (`:84-86,98,147`).
- **`(dashboard)/page.tsx:174,179`** — "Top groups" and `summary.topGroups`.
- **`_components/top-categories.tsx`** → `top-groups.tsx`, `TopGroups`, reading `row.group` (`:6,21,24`). The empty state reads "No groups to show yet." (`:12`).
- **`expenses/categories/_components/categories-view.tsx`**
  - Title "Categories" (`:72`).
  - Description "File Expenses, Transactions and receipt items under one shared list." (`:71`).
- **`category-form.tsx`**
  - Dialog copy "A Category files Expenses, Transactions and receipt items." (`:68`).
  - Drop the `expense.list` invalidation (`:35-39`), because a rename no longer writes Expenses.
- **`receipts/_components/receipt-detail.tsx:419-423,461-468`** — `item.categoryName`, `item.categoryId`, and the `setItemCategory({ itemId, categoryId })` input.

**Commit A: docs**

- `docs/adr/adr017-*.md:45` — `categoryId` and `group`.
- `docs/adr/adr024-*.md:65` — replace "One custom migration" with the three-file shape: a generated rename that adds a nullable `categoryId`, a custom backfill, then a generated not-null and drop. Explain why: a custom file copies the previous snapshot. All three run in one `make db_migrate`.
- `.claude/rules/e2e-testing.md:11,35-36` and `.claude/skills/pull-request/SKILL.md:16` — use the new names.
- `docs/adr/adr003-*.md:16,31` — repoint the stale `category.ts:94,125` citations at `expenses.repository.ts`'s `reorderCategories`.

### Success

- [x] `make check` passes. `db:check` accepts `0012`–`0014`.
- [x] `make test` passes. Commit A0 is green against the unchanged `receipts.ts`. In Commit A, every snapshot diff is a rename, plus the intended changes:
  - the `list` and `findUnplanned` order
  - the one-statement Category rename
  - the id-based join and count
- [x] `make build` passes
- [x] On the Phase 1 branch, `make db_migrate` applies `0012`–`0014` in one run, and the Phase 2 step 7 checks hold
- [x] `git grep -n -E "expenseCategor|expense_category|EXPENSE_CATEGORIES|topCategories" -- src` returns nothing. `drizzle/` is history and is not searched. Only hit: the plan's own index name `expense_category_idx` (`expenses.schema.ts:37`).
- [x] At https://personal-finance.localhost (on the migrated branch):
  - Renaming a Category updates the Expenses page group label with no Expense write.
  - An Expense cannot be saved without a Category.
  - The Expenses page and the Unplanned page group in managed order, and "No category" comes last on the Unplanned page.
  - Sorting by Group on the Transactions page works.
- [x] A receipt item's Category picker saves. *(Validate: receipt 9 matched to tx 643 for the test, picker clicked in the browser on item 14 → Utilities; DB held `categoryId` 3, UI showed "Utilities", options in managed order. Item and match reverted.)*
- [x] `/design-review`: Expenses, Unplanned, Transactions (list and form), dashboard Top groups, Categories, receipt detail
- [x] `/security-review` (`src/lib/constants.ts`)

## Phase 3: Commit B — the domain move

One commit. Implements adr024 (the domain), adr023 (a top-level domain that mirrors `src/domain/categories/`), adr021 (its controller) and adr022 (names through the owning service).

### Changes

- **Move `src/server/expenses/categories.schema.ts` → `src/server/categories/categories.schema.ts`**, unchanged (`git mv`). Move its test the same way.
  - Update every importer to `~/server/categories/categories.schema`. These are `expenses.schema.ts`, `transactions.schema.ts:3`, `receipts.schema.ts:10`, `db/index.ts:8`, `schema-interface-contract.test.ts:14`, `routers/receipts.ts:36`, `receipts/receipts.repository.ts:5` and `receipts.repository.test.ts:4`.
  - drizzle-kit globs `src/server/**/*.schema.ts`, so `make db_generate` produces no file.
- **New `src/server/categories/categories.repository.ts`** — `CategoriesRepository` port and `DrizzleCategoriesRepository`. Lift these from `expenses.repository.ts`:
  - `list` from `listCategories` (`:95-110`), with **no join and no count**: `select().from(categories).orderBy(sortOrder, name)`.
  - `nextSortOrder` (`:113-123`).
  - `insert` (`:125-133`).
  - `find` (`:135-141`).
  - `update` (the one-statement form from Commit A).
  - `reorder` (`:166-175`, still `this.db.transaction`).
  - `delete` (`:185-187`).
  - `findNames` (`:196-201`).
- **New `categories.repository.test.ts`** — move the Category cases out of `expenses.repository.test.ts:176-482,504-520`, with their `harness` (`:16-23`). The `list` snapshot loses the join and the count.
- **New `src/server/categories/categories.service.ts`** — `CategoriesService`.
  - Move these from `ExpensesService`: the name-taken and not-found copy, `rethrowNameTaken` and `normalizeCategory` (`:20-39`).
  - `list`, `create`, `update` and `reorder(ids)` work as `:81-106`.
  - **`delete(id)`.** Find or throw `NotFoundError`, then delete. A `ForeignKeyViolation` becomes `ConflictError(\`Cannot delete "${name}" — expenses still use it.\`)`. Any other error passes through. The count leaves the message (adr024 `:62`).
  - **`namesByIds(ids: number[]): Promise<ReadonlyMap<number, string>>`.** An empty list makes no query.
  - The class comment says it sits at the bottom of the graph and calls nothing.
- **New `categories.service.test.ts`** — move the Category cases from `expenses.service.test.ts:138-358`, with `serviceWith` in the `:15-34` style. Add these cases:
  - The FK violation on `delete` gives the in-use `ConflictError`, and its `cause` is the driver error.
  - A missing id gives `NotFoundError`, and nothing is deleted.
  - Another error passes through unchanged (`expectPlainError`).
  - A rename calls only `repository.update`.
  - `namesByIds([])` makes no repository call.
- **New `src/server/categories/categories.trpc.controller.ts`** — `categoryRouter`, moved from `expenses/`, calling `ctx.services.categories.{list,create,update,reorder,delete}`.
- **New `categories.trpc.controller.test.ts`** — `git mv` of `expenses/categories.trpc.controller.test.ts`. Change only the import and the `callerWith` key (`:12-14`) to `categories`, and the method names. Every case (`:26-95`) keeps its assertions. This is the proof that the paths and responses held.
- **`src/server/expenses/`**
  - Delete the Category methods and copy from the service (`:1-5,20-48,81-115,136-140`) and from the repository port and implementation (`:9-14,95-187,196-201`).
  - **`namesByIds(ids: number[]): Promise<ReadonlyMap<number, string>>`**, Expense names only.
  - **New `countsByCategory(): Promise<{ categoryId: number; count: number }[]>`.** The repository runs `select categoryId, count(id)` with `mapWith(Number)`, grouped by `categoryId`.
  - **`expenses.trpc.controller.ts`** — add `countsByCategory: protectedProcedure.query(({ ctx }) => ctx.services.expenses.countsByCategory())`.
  - **Tests.**
    - Repository: the `countsByCategory` SQL snapshot (`group by "expense"."categoryId"`), and a staged count string comes back as a number.
    - Service: passes through, plus `namesByIds([])` makes no query.
    - Controller: signed in, it returns the rows. Signed out, it gives `UNAUTHORIZED`.
- **`src/domain/categories/category.interface.ts:8`** — drop `expenseCount`. **`schema-interface-contract.test.ts:31-33`** — `Equal<typeof categories.$inferSelect, Category>`, with no `Omit`.
- **`src/domain/expenses/expense.interface.ts`** — add `export interface CategoryCount { categoryId: number; count: number }`, and export it from the barrel.
- **`src/server/transactions/transactions.service.ts`**
  - Deps become `expenses: Pick<ExpensesService,"namesByIds">` plus `categories: Pick<CategoriesService,"namesByIds">`.
  - `list` makes **one `Promise.all`** of both lookups, then merges.
  - Delete the `NamesById` import.
- **`transactions.service.test.ts`**
  - `serviceWith` gains a `categories` port (`:24-42`).
  - The `list` cases (`:213-316`) assert:
    - each lookup is called once with distinct ids
    - an empty page makes no lookups with ids
    - a missing id gives a null name
- **`src/server/api/services.ts`**
  - Add `const categories = new CategoriesService({ repository: new DrizzleCategoriesRepository({ db }) })`.
  - `transactions` gets `{ repository, expenses, categories }`.
  - Add `categories` to `services`.
- **`src/server/api/root.ts:6`** — import `categoryRouter` from `~/server/categories/categories.trpc.controller`. The key `category` (`:17`) stays.
- **`src/server/architecture.test.ts:40,43`** — rewrite both specifiers to `~/server/categories/categories.schema`. The count stays 10.
- **Client**
  - **`expenses/categories/page.tsx:4-5`** — also prefetch `expense.countsByCategory`. Rename the component to `CategoriesPage`.
  - **`categories-view.tsx`**
    - Add `api.expense.countsByCategory.useSuspenseQuery()`. Build `Map(categoryId → count)` and default to 0.
    - The badge (`:94-97`) reads the map.
    - The delete success handler also invalidates `expense.countsByCategory` (`:24-28`).
  - **`expenses/_components/expense-form.tsx:97-100`** — also invalidate `expense.countsByCategory`.
- **Docs**
  - **`.claude/rules/server-architecture.md`**
    - `:18-19`: `src/server/expenses/` is a plain domain, and `src/server/categories/` is a top-level domain.
    - After the sub-resource paragraph (`:39-43`), add the adr023 table: top-level domain, sub-resource and shared kernel. Each gets one line, with the example `categories/` mirroring `src/domain/categories/`.
    - `:154-155`: `category` comes from `src/server/categories/`.
    - `:171`: `categories/categories.schema.ts`.
    - `:179-181`: `TransactionsService.list` calls `ExpensesService.namesByIds` and `CategoriesService.namesByIds`.
    - `:201`: `reorderCategories` → `CategoriesRepository.reorder`, and drop `updateCategory`.
  - **`docs/adr/adr004-*.md`**
    - `:71`: the worker reads `categories`.
    - "Done" (`:80`): `src/server/categories/` → `CategoriesService`. `ExpensesService.namesByIds` returns Expense names only.
    - "Next" (`:81`): receipts (step 7).
  - **`docs/adr/adr005-*.md`** — add `categories/categories.schema.ts` after `:41`.

### Success

- [x] `make check` passes. `make db_generate` produces no file.
- [x] `make test` passes. `categories.trpc.controller.test.ts` differs from the old file only in its import, the `callerWith` key and the method names.
- [x] `make build` passes
- [x] `git grep -n -E "categor" src/server/expenses/` hits only `categoryId` and `countsByCategory`
- [x] `git grep -n "~/server/categories/categories.schema" -- src` hits only schema files, `db/index.ts`, the contract test, and the two to-do entries' files
- [x] The to-do list has 10 entries
- [x] Every path named in the edited rules-file lines exists (`git ls-files` check)
- [x] At https://personal-finance.localhost/expenses/categories:
  - The counts match the Expenses page.
  - Deleting a used Category shows `Cannot delete "X" — expenses still use it.`
  - Deleting an empty Category works.
  - Reorder and rename still work.
  - The Network tab shows one batched request for `category.list` and `expense.countsByCategory`.

## Phase 4: Commit C — a linked Expense sets a Transaction's Category

One feature commit. Implements adr025 for Transactions. Line items wait for step 7 (adr025 `:51`). Build it by the TDD vertical-slice loop: one test, then its implementation, then repeat, in the order listed.

### Changes

- **Migration**
  1. **`make db_custom name=clear_linked_transaction_category`** → file C1:

     ```sql
     -- Pre-flight (<date>): <linked_with_own> linked Transactions held their own
     -- Category, <disagree> of them disagreeing with their Expense's. The Expense's
     -- Category wins. Rollback: not recoverable; restore from the Neon branch.
     UPDATE "transaction" SET "categoryId" = NULL WHERE "expenseId" IS NOT NULL;
     ```
  2. **`transactions.schema.ts`** — import `check` and `sql`. Add `check("transaction_expense_or_category_check", sql\`${t.expenseId} IS NULL OR ${t.categoryId} IS NULL\`)` to the extra-config array.
  3. **`make db_generate`** → file C2, which holds only `ADD CONSTRAINT … CHECK`. Add a rollback header: `DROP CONSTRAINT`.
  4. **`make db_migrate`** on the branch. Verify:
     - `SELECT count(*) FROM "transaction" WHERE "expenseId" IS NOT NULL AND "categoryId" IS NOT NULL` returns 0.
     - Writing both on one row fails with 23514.
- **`transactions.schema.test.ts`** — `getTableConfig(transactions).checks` has `transaction_expense_or_category_check`.
- **`src/server/expenses/`**
  - `namesByIds(ids)` returns `ReadonlyMap<number, { name: string; categoryId: number }>`.
  - The repository's `findNames` also selects `categoryId`.
  - Update the snapshot and the service test.
- **`src/server/transactions/transactions.repository.ts`**
  - Add `findLink(id): Promise<Pick<Transaction,"expenseId"|"categoryId"> | undefined>`.
  - `setExpense(id, expenseId)` → `setLink(id, { expenseId, categoryId })`, which writes both (`:230-240`).
  - Add SQL snapshots for both.
- **`src/server/transactions/transactions.service.ts`** — a private `categoryPatch(values)` step used by `create` and `update` (`linkExpense` applies the same rule inline):
  - **Link.** `expenseId` is a number → `categoryId: null`, whatever was sent.
  - **Unlink.** `expenseId` is `null` and `categoryId` was not sent:
    - Read `findLink(id)`. A missing row gives `NotFoundError`.
    - If the row was linked, copy the Expense's `categoryId` (from `expenses.namesByIds([old])`).
    - A deleted Expense gives `null`.
  - **Untouched.** `expenseId` was not sent → the values pass through.
  - Catch writes with a local `rethrowWriteConflict`:
    - `PgViolation.CheckViolation` → `ConflictError("A Transaction linked to an Expense takes its Category from the Expense.")`
    - anything else → `rethrowFkConflict` with the existing messages (`:18-23`)
  - **`list`** makes two calls, one after the other:
    1. `expenses.namesByIds(expenseIds)`
    2. `categories.namesByIds` for the union of each unlinked row's `categoryId` and each linked Expense's `categoryId`

    `categoryName` is the effective Category's name, and `expenseName` is unchanged.
  - Update the deps comment: Transactions → Expenses and Categories are downward calls (adr025 `:47`).
- **`transactions.service.test.ts`** — new cases, one slice each:
  - `create` with `expenseId: 5, categoryId: 3` writes `categoryId: null`.
  - `update` linking clears `categoryId`.
  - `update` unlinking with no `categoryId` copies the Expense's.
  - `update` unlinking **with** a `categoryId` keeps the one sent.
  - `update` that leaves `expenseId` out passes through.
  - Unlinking a missing row → `NotFoundError`.
  - Unlinking from a deleted Expense → `categoryId: null`.
  - `linkExpense` with a number → `setLink(id, { expenseId, categoryId: null })`.
  - `linkExpense` with `null` → it copies back.
  - A `CheckViolation` → the `ConflictError`, with `cause`.
  - FK 23503 still gives the existing messages.
  - `list`:
    - a linked row shows its Expense's Category
    - an unlinked row shows its own
    - the categories lookup runs after the expenses lookup, with the union of ids (assert the order with one shared call log)
    - a missing Category id → `null`
- **`transactions/_components/transaction-form.tsx`**
  - While `expenseId` is set, the Category select:
    - is `readOnly`, not `disabled`, so it stays focusable and its value is read out
    - shows the linked Expense's `categoryId` (from the `expenses` prop)
    - shows a hint below it: "Set by the Expense. Choose None to edit." Unlinked, it reads "Linking an Expense sets this."
  - Picking an Expense sends `categoryId: null`.
  - Clearing the Expense pre-fills the Expense's Category, so it can still be changed before saving.
- **Docs**
  - `docs/adr/adr024-*.md:64` — the lookups ran in parallel until adr025 made them sequential. Link adr025.
  - `docs/adr/adr010-*.md` — add "Related: adr025" after `:98`.

### Success

- [x] `make check` passes. `make db_generate` after C2 produces no file.
- [x] `make test` passes
- [x] `make build` passes
- [x] On the branch, `make db_migrate` applies C1 and C2. The Phase 4 migration checks hold.
- [x] At https://personal-finance.localhost/transactions:
  - Linking an Expense in the form locks the Category picker to that Expense's Category. After saving, the list shows that Category.
  - Clearing the Expense pre-fills its Category. After saving, the Transaction keeps it.
  - Linking from the Unplanned page moves the row out of Unplanned. After unlinking (edit form, Expense → None), the row returns to Unplanned under its old Expense's Category.
  - Moving an Expense to another Category changes the Category shown on its linked Transactions.
- [x] `/design-review`: the Transactions form, linked and unlinked

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md`. It carries `## Related ADRs` (`:938-946`). Relevant sections:
  - § Migration step 6 (`:820-834`)
  - § Categories as its own domain (`:651-748`): the data change `:658-669`, the backfill `:676-690`, the services `:692-705`, the read paths `:707-719`, a linked Expense `:721-748`
  - § Testing, step 6 (`:785-799`)
  - § Router map (`:287,296-299`)
  - § Dependency graph (`:305-323`)
  - § Module files (`:395-398`)
  - § Doc changes (`:860-863`)
  - § ADR Impacts (`:919-936`)
- ADRs:
  - `docs/adr/adr024-category-own-domain-linked-by-id.md` (Proposed) — implemented by Phase 2 (data and names) and Phase 3 (the domain). `:65` is edited in Phase 2, `:64` in Phase 4.
  - `docs/adr/adr025-linked-expense-sets-the-category.md` (Proposed) — implemented by Phase 4 for Transactions. Line items are step 7.
  - `docs/adr/adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md` (Proposed) — implemented by Phase 3. Categories become a top-level domain, and the rules file gains the table.
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phase 3 (`categories.trpc.controller.ts`, `expense.countsByCategory`).
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — implemented by Phase 3 (the `CategoriesService.namesByIds` port) and Phase 4 (the downward unlink read).
  - Accepted ADRs edited:
    - adr004 (Phase 3)
    - adr005 (Phase 3)
    - adr017 (Phase 2)
    - adr003 citations (Phase 2)
    - adr010 Related link (Phase 4)
- Prior plans:
  - `thoughts/plans/2026-10-07-trpc-3-tier-step-5-cashflow.md`
  - `thoughts/plans/2026-10-02-trpc-3-tier-step-2-expenses-categories.md` (the controllers this step splits)
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/database-migrations.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md`:
  - Transaction `:25-26`, Expense `:28-31`, Unplanned `:33-36`, Category `:62-65`, Group `:96-99`
  - Relationships `:112-122`
  - Ambiguities `:177-190`
- Related:
  - `node_modules/drizzle-kit/bin.cjs:19841-19846,23520-23560`
  - `drizzle/0008_wide_steel_serpent.sql` (rename precedent)
  - `drizzle/meta/0011_snapshot.json`
  - `scripts/neon-branch.sh:161-223`
  - `src/server/errors/fk-conflict.ts`, `src/server/errors/parse-error.ts:6-18`
  - `src/test/fakes.ts:9-39`, `src/server/db/recording-db.fake.ts`
