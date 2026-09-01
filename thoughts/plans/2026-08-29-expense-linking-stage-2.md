# Expense Linking Stage 2 — `kind` + Timing Columns, One-Time UI Implementation Plan

## Context

Stage 2 of the 2026-08-16 expense-linking/receipts/cashflow design (Build order item 2): give `expense` and `income` a `kind` discriminator (`recurring | one-time`) plus one-time (`amount`, `expectedDate`) and Timing (`dueDay`, `dueMonth`) columns, and add a one-time budget UI to the Planned page — a new section showing amount, expected date, consumed (sum of linked Transactions), and remaining, with past-dated ones collapsing into a "past" group. This is the first implementation of **adr011** (one-time budgets as an `expense` `kind`); it flips from Proposed to Accepted here. All schema changes are additive + nullable, no backfill.

## Current State

- `expense` and `income` are structurally identical bar their two leading text columns — `id`, `name`/`category` (expense) or `person`/`source` (income), `fortnight`/`month`/`year` (`doublePrecision().notNull().default(0)`), `sortOrder`, `createdAt`, `updatedAt`. No `kind`, no date, no Timing columns — `src/server/expenses/expenses.schema.ts:3-16`, `src/server/income/income.schema.ts:3-16`. Cadence is **not** a stored discriminator: each row holds all three figures at once; "Basis" is a UI-only concept back-derived in the form.
- Managed vocab = TS string enum in `src/lib/constants.ts` (`Priority` `:1-8`, `Frequency` `:10-13`, with `toFrequency`/`toPriority` read-coercion `:18-27`), wrapped into a `pgEnum(Object.values(Enum) as [Enum, ...Enum[]])` and used as `enum().notNull().default(...)` — see `src/server/transactions/transactions.schema.ts:6-13,30-31`. **No `provenance` enum exists** (that's a later stage).
- DTOs share a `*Fields` object spread into a bare create DTO and an update DTO that adds `id`; amount fields are `.optional()` with no `.default()` so create falls through to the DB default and update's `.set()` preserves omitted values — `src/domain/expenses/expense.dto.ts:5-23`, `src/domain/income/income.dto.ts:5-21`. Interfaces at `src/domain/expenses/expense.interface.ts:1-11`, `src/domain/income/income.interface.ts:1-11`.
- Routers are plain (adr012): create/update spread `input` straight into `.values()`/`.set()`, so a new DTO field of the same name reaches its column automatically — `src/server/api/routers/expense.ts:12-49`, `src/server/api/routers/income.ts:8-41`. `expense.list` is `select().from(expenses)` (all columns) `:13-22`; wired in `src/server/api/root.ts:15-16`. There is **no per-expense consumption rollup** — only the `transaction.expenseId` FK (`src/server/transactions/transactions.schema.ts:19-21`) links the two.
- Contract tests: `WritesInto`/`Expect`/`Equal` helpers at `src/test/type-contracts.ts`; DTO tests at `src/domain/expenses/expense.dto.test.ts`, `src/domain/income/income.dto.test.ts` (a compile-time `Contracts` tuple + runtime parse cases). Schema-default tests assert column metadata via `getTableColumns` — `src/server/expenses/expenses.schema.test.ts:8-27`, `src/server/income/income.schema.test.ts:8-27`.
- Planned page: server component prefetches then hydrates `ExpensesView` — `src/app/(dashboard)/expenses/page.tsx:1-12`. `ExpensesView` groups **all** expenses by category into collapsible cards (`groups` memo `src/app/_components/expenses/expenses-view.tsx:40-56`, render `:112-201`, collapse `Set` `:29,:31-38`), with top summary Cards `:89-109` (`totals` `:58-65`) and each row showing name + fortnight/month/year `:155-196`. `ExpenseForm` (single dialog, `key`-remounted `:218-223`) has Name, Category, a single Amount, and a UI-only Basis select that drives `deriveAmounts` — `src/app/_components/expenses/expense-form.tsx:44-53,65-75,77-90,102-148`.
- Income page mirrors this: `IncomeView` groups by person, summary Cards, rows show fortnight/month/year — `src/app/_components/income/income-view.tsx:28-45,92-167`. `IncomeForm` enters a single per-fortnight amount and derives month/year (no Basis select) — `src/app/_components/income/income-form.tsx:32-64`.
- Formatting helpers: `<Money>` (`src/app/_components/money.tsx`), `formatDate` (`src/lib/utils.ts:41-45`, `"—"` for null), `toDateInput`/`fromDateInput` (`src/lib/utils.ts:50-75`). Dated-form precedent: `transaction-form.tsx:65,91,161-170` (`<input type="date">` seeded via `toDateInput`, submitted as `new Date(\`${date}T00:00:00\`)`).
- Migrations: latest is `drizzle/0002_expense_linking_stage_1.sql`; next index is `0003`. Two-step `make db_generate` → `make db_migrate`; **`make db_migrate` and `.env` reads are user-run**, never the agent. Never `drizzle-kit push`.
- **DB caution:** on `main` the `DATABASE_URL` is production Neon. Do all migration/write work on a feature branch/worktree (branch off to `expense-linking-stage-2`), never main.

## Desired End State

- `expense` and `income` each carry `kind` (pgEnum `recurring | one-time`, `NOT NULL DEFAULT 'recurring'`), nullable `amount` (double) and `expectedDate` (timestamptz) for one-time figures, and nullable `dueDay` (1–31) / `dueMonth` (1–12) Timing columns — in one applied, git-tracked migration. Existing rows all read as `recurring`.
- Create/update DTOs validate the new fields and enforce, in Zod (not a DB CHECK), that a `one-time` row supplies both `amount` and `expectedDate`. Interfaces and contract tests stay in lockstep (build green).
- The Planned page splits expenses by `kind`: recurring rows keep their category cards (untouched), and a new **One-time** section lists name / amount / expected date / consumed / remaining, with past-`expectedDate` rows in a collapsible "past" group. `ExpenseForm` offers a kind toggle; one-time entry shows amount + expected date instead of Basis.
- The Income page and `IncomeForm` gain the same kind toggle + one-time entry and a recurring/one-time split — without a consumed column (Income has no linking FK, design decision 10).
- adr011 flips to **Accepted** with a consequence note recording that `kind` shipped as a pgEnum (repo convention) rather than the literal `text` in its wording.

## Out of Scope

- **Recurring "actual" column + period picker on the Planned page** — deferred to stage 3, where period bucketing arrives with the cash-flow chart. Stage 2's consumed/remaining is a *lifetime* sum (one-time only), no period window.
- **Timing (`dueDay`/`dueMonth`) input UI** — the columns and their DTO validation land here so the shape is fixed, but the pickers ship with stage 3, where Timing drives the projection and has visible effect. No inert stage-2 form fields.
- Cash-flow chart, `balance_snapshot` (stage 3); outbox/Inngest (stage 4); receipts/email (stages 5–6); `provenance`/`externalId`/`accountName` (import/sync stages).
- Any service/repository/module tier — adr012 forbids introducing 3-tier ceremony in feature branches; stay plain-router.
- `householdId` scoping; Drizzle `relations()`; changing `expense.list`'s shape (pickers depend on it — consumption is a separate query).

## Approach

Three vertical slices in the repo's plain-router style (adr012). **Phase 1** is the shared data layer for both tables in one migration — TS enum + pgEnum, nullable columns, DTO fields with the one-time invariant, interfaces, and schema/DTO tests written test-first (adr011, adr005). **Phase 2** adds a dedicated `expense.consumption` aggregation and the Planned-page one-time UI (section, past group, consumed/remaining, form kind toggle), reusing the existing category-group/collapse and `<Money>`/date-input patterns. **Phase 3** mirrors the one-time entry + split onto the Income surface, minus consumed. Vocabulary per `CONTEXT.md`: `kind` values `recurring`/`one-time` (lowercase; deliberately distinct from a Transaction's `Frequency`), Basis, Timing, Spend/Inflow.

## Phase 1: Data layer — `kind` + timing columns on `expense` & `income`

Implements **adr011** — flip its `Status:` to `Accepted` when this phase lands, with a consequence note that `kind` shipped as a pgEnum.

### Changes

- `src/lib/constants.ts` — add `export enum CommitmentKind { Recurring = "recurring", OneTime = "one-time" }` and a `toCommitmentKind(value): CommitmentKind` read-coercion helper defaulting to `Recurring`, mirroring `toFrequency`/`toPriority` (`:18-27`). One shared TS enum serves both records (the concept is identical).
- `src/lib/constants.test.ts` (or extend an existing constants test) — **written first**: `toCommitmentKind` maps `"recurring"`/`"one-time"` through and coerces unknown/null/undefined to `Recurring`.
- `src/server/expenses/expenses.schema.ts` — declare `export const expenseKind = pgEnum("expense_kind", Object.values(CommitmentKind) as [CommitmentKind, ...CommitmentKind[]])` (import `pgEnum`, `CommitmentKind`); add to the table: `kind: expenseKind().notNull().default(CommitmentKind.Recurring)`, `amount: d.doublePrecision()` (nullable), `expectedDate: d.timestamp({ withTimezone: true })` (nullable), `dueDay: d.integer()` (nullable), `dueMonth: d.integer()` (nullable).
- `src/server/income/income.schema.ts` — same, with a table-scoped `export const incomeKind = pgEnum("income_kind", …)` (two pg types, one per schema file, keeps each domain schema self-contained per adr005 and matches the `transaction_frequency` naming convention) and the identical five columns.
- `src/domain/expenses/expense.interface.ts` / `src/domain/income/income.interface.ts` — add `kind: CommitmentKind`, `amount: number | null`, `expectedDate: Date | null`, `dueDay: number | null`, `dueMonth: number | null`.
- `src/domain/expenses/expense.dto.ts` / `src/domain/income/income.dto.ts` — add to the shared `*Fields`: `kind: z.enum(CommitmentKind).optional()`, `amount: z.number().nonnegative().nullable().optional()`, `expectedDate: z.date().nullable().optional()`, `dueDay: z.number().int().min(1).max(31).nullable().optional()`, `dueMonth: z.number().int().min(1).max(12).nullable().optional()`. Wrap **both** create and update objects in a shared `.superRefine` that, when `kind === CommitmentKind.OneTime`, adds an issue on `amount` and/or `expectedDate` if either is null/absent (adr011: invariant in Zod, not a DB CHECK). `z.enum(NativeEnum)` follows the `z.enum(Frequency)` precedent in `transaction.dto.ts`.
- `src/domain/expenses/expense.dto.test.ts` / `src/domain/income/income.dto.test.ts` — **written first**: `kind` accepts `recurring`/`one-time`/omitted, rejects junk; `amount`/`expectedDate` accept null/omitted/valid; `dueDay` rejects 0 and 32, `dueMonth` rejects 0 and 13, negatives rejected; the invariant — `one-time` without `amount` rejected, without `expectedDate` rejected, with both accepted, `recurring` without them accepted. Keep the `Contracts` tuple green (WritesInto still holds after the interface update).
- `src/server/expenses/expenses.schema.test.ts` / `src/server/income/income.schema.test.ts` — **written first**: `cols.kind.default === CommitmentKind.Recurring`; `amount`/`expectedDate`/`dueDay`/`dueMonth` have `notNull === false` and `hasDefault === false`.
- Routers (`expense.ts`, `income.ts`) — **no change**: `input` already spreads into `.values()`/`.set()`, so new same-named fields flow through; `list`'s `select()` already returns every column.
- `drizzle/0003_*.sql` — `make db_generate`; review it is purely `CREATE TYPE "expense_kind"/"income_kind"` + `ADD COLUMN` (with the `kind` default) — **no** text→enum cast, no backfill (contrast the hand-edited `0002`); optionally rename the file + its `_journal.json` tag to `0003_expense_income_kind_timing` for readability. Then `make db_migrate` (user-run) on the feature-branch DB.

### Success
**Automated**
- [x] `make test` passes (new DTO + schema-default + coercion cases green) — 149 tests pass
- [x] `make check` passes (includes `db:check`; contract `WritesInto` tuple compiles) — typecheck + db:check + biome clean on all Phase-1 files; the one remaining biome error is an unrelated `.claude/settings.json` trailing-newline change from `/remote-control`, not this phase
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [ ] Migration generated and applied on the **feature-branch** DB (never main/prod): `expense`/`income` gain `kind` (`recurring` default), `amount`, `expectedDate`, `dueDay`, `dueMonth`; existing rows read `recurring` — verified via SQL probe on the branch.
- [ ] Create a `one-time` expense with `amount` + `expectedDate` via the DTO path; confirm it persists and that a `one-time` payload missing `amount` is rejected.
- [ ] `/security-review` (phase touches `src/lib/**`).

## Phase 2: `expense.consumption` read + Planned-page one-time UI

### Changes

- `src/server/api/routers/expense.ts` — add `consumption: protectedProcedure.query(...)` returning `{ expenseId: number; consumed: number }[]`: `select` `transactions.expenseId` + `sql<number>\`coalesce(sum(${transactions.amount}), 0)\`` from `transactions` where `isNotNull(transactions.expenseId)`, `groupBy(transactions.expenseId)`; coerce the sum to a JS number (`Number(...)` / `.mapWith(Number)`). Reads the sibling `transactions` table for a Planned-page read-model (allowed cross-domain read-join). Consumed nets refunds (negative Inflow) against Spend, per glossary signs.
- `src/lib/utils.ts` — add pure `isPast(date: Date, now: Date): boolean` comparing **local calendar days** (a one-time due today is upcoming, not past — "date does the work, no archive flag", adr011).
- `src/lib/utils.test.ts` — **written first**, table-driven: today → false, a time-of-day today → false, yesterday → true, tomorrow → false, across a month/year boundary.
- `src/app/(dashboard)/expenses/page.tsx` — add `void api.expense.consumption.prefetch()` beside the existing prefetches (`:5-6`).
- `src/app/_components/expenses/expenses-view.tsx`:
  - Consume the now-richer `expense.list` output (`kind`/`amount`/`expectedDate` arrive automatically from Phase 1's `select()`); add `const [consumption] = api.expense.consumption.useSuspenseQuery()` and build a `Map<number, number>` of expenseId → consumed.
  - Filter the `groups` memo (`:40-56`) and `totals` (`:58-65`) to `kind === CommitmentKind.Recurring` so one-time rows never appear in the category cards or the fortnight/month/year summaries.
  - Add a **One-time** section in the `mt-6 flex flex-col gap-6` container (`:111`), after `{groups.map(...)}`: partition one-time expenses by `isPast(expectedDate, new Date())` into "upcoming" and a collapsible "past" sub-group (reuse the `collapsed` `Set` idiom `:29,:31-38`). Each row: name, `<Money>` amount, `formatDate(expectedDate)`, `<Money>` consumed = `map.get(id) ?? 0`, `<Money>` remaining = `(amount ?? 0) − consumed`; reuse the edit/delete actions (`:179-195`). Show over-consumed (remaining < 0) with a warning tone.
- `src/app/_components/expenses/expense-form.tsx`:
  - Add a `kind` state (default `Recurring`, seeded from `expense?.kind` in the open effect) and a kind `SelectField`/toggle (Recurring | One-time).
  - **Recurring**: keep the existing Amount + Basis → `deriveAmounts` path (`:65-75,126-148`); submit `kind: recurring`, the derived `{fortnight,month,year}`, and `amount: null, expectedDate: null`.
  - **One-time**: hide Basis; show a single Amount and an expected-date `<input type="date">` (seed via `toDateInput`, submit `new Date(\`${date}T00:00:00\`)`, mirroring `transaction-form.tsx:161-170`); submit `kind: one-time`, `amount`, `expectedDate`, and `{fortnight:0, month:0, year:0}` (the three figures are unused for one-time).
  - Extend the submit `payload` (`:86`) accordingly; mutation wiring (`:56-62`) is unchanged.

### Success
**Automated**
- [x] `make check` passes — biome + typecheck + db:check all clean
- [x] `make test` passes (`isPast` table green) — 155 tests pass
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [x] Add a one-time expense → it appears in the One-time section (not a category card) with amount, expected date, consumed 0, remaining = amount — verified live via Playwright.
- [x] Link a Spend Transaction to it (existing picker) → consumed rises, remaining falls; a refund nets consumed back down — linked a $623.80 Spend (consumed → $623.80, remaining → $1,376.20), then a −$100 refund (consumed netted to $523.80, remaining $1,476.20); data restored.
- [x] Set its expected date to yesterday → it moves into the collapsible "past" group; a today date stays upcoming — a past-dated one-time moved into the collapsed "Past (1)" group; `isPast` keeps today upcoming (unit-covered).
- [x] Recurring expenses and the summary totals are unchanged — category cards + Per fortnight/month/year totals unchanged (one-time excluded from the recurring totals memo).
- [x] `/design-review` (UI change) — no blockers/high-priority; 2 medium a11y findings on the form fixed (`role="alert"` on the error banner + `noValidate` to suppress the native date bubble); nitpicks left (number-input integer display is conventional).
- [x] `/security-review` (phase touches `src/lib/**`) — no findings ≥ confidence 8; `consumption` query is parameterized + auth-gated.

## Phase 3: Income one-time entry + split

### Changes

- `src/app/_components/income/income-form.tsx`:
  - Add `kind` state (default `Recurring`, seeded from `income?.kind` in the open effect `:36-42`) + a kind toggle.
  - **Recurring**: keep the per-fortnight Amount → month/year derivation (`:54-61`); submit `amount: null, expectedDate: null`.
  - **One-time**: show a single Amount + expected-date `<input type="date">` (same helpers as Phase 2); submit `kind: one-time`, `amount`, `expectedDate`, `{fortnight:0,month:0,year:0}`.
  - Extend the `payload` (`:55-61`).
- `src/app/_components/income/income-view.tsx`:
  - Filter `groups` (`:28-36`) and `totals` (`:38-45`) to `kind === CommitmentKind.Recurring`.
  - Add a **One-time** section (mirror Phase 2's layout in the `mt-6 flex flex-col gap-6` container `:92`, reusing `<Money>` + `formatDate`) showing name/source, amount, expected date — **no** consumed/remaining column (Income has no linking FK, decision 10) — with the same upcoming/"past" split via `isPast`.
- `src/app/(dashboard)/income/page.tsx` — no new query needed (`income.list` already returns the new columns); confirm prefetch covers it.

### Success
**Automated**
- [x] `make check` passes — biome + typecheck + db:check all clean
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [x] Add a one-time income → appears in the Income One-time section with amount + expected date; recurring income and totals unchanged — verified live in `/design-review`.
- [x] A past-dated one-time income sits in the "past" group — verified live (starts collapsed in a working "Past (n)" accordion).
- [x] `/design-review` (UI change) — 1 high fixed (stale Add-form state: reverted to reseed-on-open), income-specific mediums fixed (mobile amount now visible, responsive form grid, Past-toggle focus ring); the same stale-Add bug in `expense-form.tsx` was fixed for parity (reseed-on-open + dropped remount key). Banner-placement + expenses-view mobile/focus parallels left as pre-existing Phase-2 patterns.

## Validate

Run `/validate` over the whole branch (its standing `/code-review` step). Confirm: adr011 flipped to Accepted with the pgEnum consequence note; adr012 style honored (no service/repo tier); terminology canonical (`recurring`/`one-time`, Basis, Timing); the migration is additive-only and was applied only on a feature-branch DB.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` (Build order item 2; Data model → `expense`/`income`; carries `## Related ADRs`)
- Prior plan: `thoughts/plans/2026-08-17-expense-linking-stage-1.md` (stage-1 conventions this mirrors; its Out of Scope defers `kind`/timing + one-time UI here)
- ADRs:
  - `docs/adr/adr011-one-time-budgets-as-expense-kind.md` (**Proposed**) — implemented by Phase 1; flip to Accepted, note `kind` shipped as pgEnum (not literal `text`)
  - `docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md` (Accepted) — governs style: plain routers, no 3-tier ceremony in feature branches
  - `docs/adr/adr005-per-domain-drizzle-schema-files.md` (Accepted) — per-domain `*.schema.ts`, `*.dto.ts`, migration two-step
  - `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` (Accepted) — the `transaction.expenseId` FK that `expense.consumption` sums
- Terminology: `CONTEXT.md` (Expense/Income `kind` `recurring`/`one-time`; Basis; Timing; Spend/Inflow signs)
- Key code: `src/server/expenses/expenses.schema.ts:3-16`, `src/server/income/income.schema.ts:3-16`, `src/server/transactions/transactions.schema.ts:6-13,30-31`, `src/lib/constants.ts:1-27`, `src/domain/expenses/expense.dto.ts:5-23`, `src/domain/income/income.dto.ts:5-21`, `src/domain/{expenses,income}/*.interface.ts`, `src/server/api/routers/expense.ts:12-49`, `src/server/api/routers/income.ts:8-41`, `src/app/(dashboard)/expenses/page.tsx:1-12`, `src/app/_components/expenses/expenses-view.tsx:29,40-65,111-201`, `src/app/_components/expenses/expense-form.tsx:44-90,102-148`, `src/app/_components/income/income-view.tsx:28-45,92-167`, `src/app/_components/income/income-form.tsx:32-64`, `src/lib/utils.ts:41-75`, `src/test/type-contracts.ts`
