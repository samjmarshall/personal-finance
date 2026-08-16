# Transaction → Planned-Expense Mapping Implementation Plan

## Context
Transactions and planned expenses are unrelated tables today — a real transaction cannot be tied to the planned expense it fulfils. Add a nullable foreign key from `transaction` to `expense` so a transaction can be mapped to a planned expense (`transaction.expenseId` → `expense.id`), pick it in the transaction form, and see the mapping in the transaction list.

## Current State
- `transaction` table has no FK to any domain table — only `date`/`priority` indexes (`src/server/transactions/transactions.schema.ts:3-25`). `expense` table likewise carries no FKs (`src/server/expenses/expenses.schema.ts:3-16`). Both use `integer` identity PKs (`transactions.schema.ts:6`, `expenses.schema.ts:4`).
- No `relations()` exist on either domain table; the only real FK + `relations()` in the repo is auth's `account`/`session` → `user` (`src/server/db/shared.schema.ts:30-32`). Cross-domain joins are done manually with `eq(...)` (precedent: `src/server/api/routers/category.ts:27`).
- The transaction router hits `ctx.db` directly (no service/repository tier): input schema `transactionInput` (`src/server/api/routers/transaction.ts:25-33`), `list` returns `.select()` of all columns (`transaction.ts:71-95`), `create` (`transaction.ts:166-174`), `update` (`transaction.ts:176-186`).
- The transaction form takes a `categories: string[]` prop supplied by the view (`src/app/_components/transactions/transaction-form.tsx:20-30`); the view fetches it via `api.transaction.categories.useSuspenseQuery()` (`src/app/_components/transactions/transactions-view.tsx:43`) and renders the form at `transactions-view.tsx:342-347`. The `expense.list` query already returns all planned expenses (`src/server/api/routers/expense.ts:15-24`).
- Migrations: per-domain schema glob `./src/server/**/*.schema.ts` (`drizzle.config.ts:6`), SQL files in `drizzle/` (latest `0001_wakeful_zeigeist.sql`), two-step `make db_generate` → `make db_migrate`, never `drizzle-kit push`.
- Tests: vitest, `environment: "node"`, `include: ["src/**/*.test.ts"]` (`vitest.config.ts`). No jsdom/component testing, no DB harness — existing tests are pure-unit with mocked deps (`src/lib/utils.test.ts`, `src/server/auth/secondary-storage.test.ts`). Only the Zod input schema is unit-testable here.

## Desired End State
- `transaction` has a nullable `expenseId integer` column with a FK to `expense.id`, `ON DELETE SET NULL`, recorded in a generated + applied migration.
- Creating or editing a transaction persists an optional planned-expense mapping; clearing it stores `null`.
- The transaction form shows an expense picker ("— None —" default); the transaction list shows the mapped expense name (or "—").
- Deleting a planned expense unmaps its transactions (row survives, `expenseId` → `null`).

## Out of Scope
- Building the ADR004 3-tier service/repository/`commit` architecture — it is Accepted but **"Not started"**; this feature mirrors the current flat-router shape and does not begin that migration.
- Adding Drizzle `relations()` blocks — no domain table has them today; the list join is done manually with `leftJoin` per the existing `category.ts` precedent.
- `householdId` scoping (planned, not yet in schema).
- Sorting/filtering transactions by mapped expense; two-way navigation from an expense to its transactions.
- The future uuid-PK migration noted in ADR003 — the FK is `integer` to match today's `expense.id`; it migrates with the PK if/when that lands.

## Approach
Vertical data slice first (schema column → migration → router persistence → list join → one Zod unit test), then the UI slice (form picker → list column). The FK is a lazy-thunk cross-file reference per ADR005; the input Zod schema is extracted to a `transactions-schemas.ts` file (dash suffix, per the documented Zod-file convention) so it can be unit-tested without importing the tRPC/env graph.

## Phase 1: Data layer — FK column, migration, persistence, list join

### Changes
- `src/server/transactions/transactions.schema.ts` — add `expenseId: d.integer().references(() => expenses.id, { onDelete: "set null" })` (nullable). Import `expenses` from `~/server/expenses/expenses.schema` (cross-domain schema import for the FK thunk — allowed by ADR005).
- `drizzle/` — run `make db_generate` to emit the next migration (`0002_*.sql`), then `make db_migrate` to apply it. Review the generated SQL: it must only `ADD COLUMN` on `transaction` plus the FK constraint (`ON DELETE set null`) and touch nothing else.
- `src/server/transactions/transactions-schemas.ts` — new file; move `transactionInput` here (`transaction.ts:25-33`) and add `expenseId: z.number().int().nullable().optional()`. Export it. (`listInput` stays inline in the router — list-specific.)
- `src/server/api/routers/transaction.ts` — import `transactionInput` from `./…/transactions-schemas`; in `create` set `expenseId: input.expenseId ?? null`; in `update` carry `expenseId` through the `set(...)`. In `list`, project `{ ...getTableColumns(transactions), expenseName: expenses.name }` and `leftJoin(expenses, eq(transactions.expenseId, expenses.id))` so each row carries `expenseId` + `expenseName` (import `getTableColumns` from `drizzle-orm` and `expenses` from the expenses schema). The count query is unchanged.
- `src/server/transactions/transactions-schemas.test.ts` — new vitest unit test on `transactionInput` (TDD: write first, then wire the field): accepts a numeric `expenseId`; accepts `null` and omitted; rejects a non-numeric/float `expenseId`. Mirrors the pure-unit style of `src/lib/utils.test.ts`.

### Success
**Automated**
- [ ] `make test` passes (new `transactions-schemas.test.ts` green)
- [ ] `make check` passes (biome + `tsc --noEmit` + `drizzle-kit check` — schema/migration consistent)
- [ ] `make build` passes

**Manual**
- [ ] `make db_generate` produced one migration that only adds `transaction.expenseId` + its FK; `make db_migrate` applied it cleanly against the dev DB
- [ ] Creating a transaction with an `expenseId` persists it; `expense.list` row deleted → mapped transactions' `expenseId` becomes `null` (row survives)

## Phase 2: UI — expense picker and list display

### Changes
- `src/app/_components/transactions/transactions-view.tsx` — fetch planned expenses with `api.expense.list.useSuspenseQuery()` (mirroring the `categories` suspense query at `:43`); pass an `expenses` prop into `<TransactionForm>` (`:342-347`). Add a "Planned expense" `<th>` to the table header (`:203-224`) and a `<td>` rendering `tx.expenseName ?? "—"` in the row (`:231-287`); bump the empty-state `colSpan` from 6 to 7 (`:292`).
- `src/app/_components/transactions/transaction-form.tsx` — add `expenses` to props (typed from `RouterOutputs["expense"]["list"]`); add `expenseId` string state seeded from `transaction?.expenseId` in the `open` effect (`:40-49`); render a `<Select>` (already imported, `:6`) with an `<option value="">— None —</option>` default followed by one option per expense (`value={String(e.id)}`, label `e.name`), placed beside the Category field; in `submit` add `expenseId: expenseId ? Number(expenseId) : null` to the payload (`:65-73`).

### Success
**Automated**
- [ ] `make check` passes
- [ ] `make build` passes

**Manual**
- [ ] Add/edit a transaction: pick a planned expense, save, reopen — selection persists; choose "— None —" and save — mapping clears
- [ ] Transaction list shows the mapped expense name, "—" when unmapped
- [ ] `/design-review`

## References
- Ticket: none supplied (feature request: `transaction.expense` → `expense.id`)
- Design doc: none — no prior `thoughts/` work on transactions/expenses mapping
- ADRs:
  - `docs/adr/adr005-per-domain-drizzle-schema-files.md` (Accepted) — schema convention this plan follows: per-domain `*.schema.ts`, lazy-thunk cross-file FK `.references(() => table.id)`, `*-schemas.ts` (dash) for Zod files, `make db_generate`/`make db_migrate`
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted, **Not started**) — composed with, not implemented; feature stays on the current flat router and does not begin the 3-tier migration
  - `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` / `adr003-*` (Accepted) — future uuid-PK / outbox posture; FK is `integer` today, out of scope
- Related code: `src/server/transactions/transactions.schema.ts:3-25`, `src/server/expenses/expenses.schema.ts:3-16`, `src/server/db/shared.schema.ts:30-32` (FK precedent), `src/server/api/routers/category.ts:27` (manual-join precedent), `src/server/api/routers/transaction.ts:25-33,71-95,166-186`, `src/server/api/routers/expense.ts:15-24`, `src/app/_components/transactions/transaction-form.tsx`, `src/app/_components/transactions/transactions-view.tsx:43,342-347`
