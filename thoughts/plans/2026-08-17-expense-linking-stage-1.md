# Expense Linking Stage 1 (Must Have) Implementation Plan

## Context

Stage 1 of the 2026-08-16 expense-linking/receipts/cashflow design: link Transactions to Expenses and to managed Expense Categories, ship the Unplanned page, and restructure the nav — zero new async infra. The two unexecuted 2026-08-11 plans are **adopted as written** (design doc "Prior art adopted"); this plan re-cites them against verified current line numbers and adds the Unplanned page + nav work. One agreed scope pull-in: the `app_setting` table (seeded `fortnightAnchor`) arrives here so the Unplanned period picker can offer fortnight windows — it is a migration, not infra.

## Current State

- `transaction` table has no FK columns at all — columns at `src/server/transactions/transactions.schema.ts:6-19`, only date/priority indexes at `:21-24`. Free-text `category` (default `"Uncategorised"`) at `:11`.
- `transactionInput` Zod schema is inline in the router at `src/server/api/routers/transaction.ts:25-33`; `list` at `:71-95` (items query `:78-84`, count `:85-88`), `create` at `:158-166`, `update` at `:168-178`. `src/domain/transactions/transaction.dto.ts` does not exist.
- Transaction form: props at `src/app/_components/transactions/transaction-form.tsx:47-57`, open-effect state seeding at `:78-87`, submit payload at `:107-120`. Pickers use `SelectField` (`:31-35`) and `Combobox` (`:6-13`) — no expense or category-FK picker.
- Transactions view: category suspense query at `src/app/_components/transactions/transactions-view.tsx:65-69`, `<TransactionForm>` at `:358-363`, 6 `<th>`s at `:221-238`, row `<td>`s at `:251-300`, empty-state `colSpan={6}` at `:308`.
- `expense.list` returns all columns, no join — `src/server/api/routers/expense.ts:15-24`. `category.list` returns id/name/description/sortOrder/timestamps/expenseCount — `src/server/api/routers/category.ts:15-31`; manual `leftJoin` precedent at `:27`.
- Nav is a flat hardcoded array — `src/app/_components/app-nav.tsx:22-28`; `activeHref` longest-match at `:30-41`; desktop `NavLinks` `:43-70`, `MobileLinks` `:186-212`.
- Pages: `(dashboard)` route group; canonical prefetch+hydrate pattern at `src/app/(dashboard)/expenses/page.tsx:4-11` (`void api.*.prefetch()` → `<HydrateClient>`); grouping-by-category precedent at `src/app/_components/expenses/expenses-view.tsx:40-56`.
- Migrations: latest is `drizzle/0001_wakeful_zeigeist.sql`; no `0002`. Two-step `make db_generate` → `make db_migrate`; never `drizzle-kit push`.
- Tests: vitest, `include: ["src/**/*.test.ts"]`, node env (`vitest.config.ts:9`; AGENTS.md's "Rstest" label is stale). Pure-unit only — no DB/component harness.
- **DB caution:** on `main` the `DATABASE_URL` is production Neon. All migration/write work in this plan happens on a feature branch/worktree.

## Desired End State

- `transaction` carries nullable `expenseId` (FK → `expense.id`, `ON DELETE SET NULL`) and nullable `expenseCategoryId` (FK → `expense_category.id`, `ON DELETE SET NULL`, indexed), in applied git-tracked migrations. Free-text `category` untouched.
- Transaction form has an expense picker and a managed-category picker; the list shows linked expense name; both round-trip on edit and clear to null.
- `/expenses/unplanned` lists Spend Transactions with `expenseId IS NULL` in a fortnight/month window, grouped by category with netted totals; an inline picker links a row to an Expense and removes it from the view.
- Nav shows an "Expenses" section — Planned / Unplanned / Categories — with Receipts absent (stage 5).
- `app_setting` exists holding `fortnightAnchor`; a missing anchor degrades the picker to month-only, never errors.
- Deleting an Expense returns its Transactions to Unplanned automatically (`SET NULL` invariant).

## Out of Scope

- Planned-page **actual** column, one-time section, `kind`/timing columns — stage 2 (adr011 implemented there, not here).
- Cash flow chart, `balance_snapshot` — stage 3. Outbox/Inngest — stage 4. Receipts, email — stages 5–6.
- Transaction `provenance`/`externalId`/`accountName` columns (staged with import/sync work).
- Backfilling or replacing free-text `category`; filtering/sorting/summarising by the new FKs beyond the Unplanned query.
- Drizzle `relations()`; any service/repository tier (adr012 forbids introducing it in feature branches).
- `householdId` scoping; pagination on the Unplanned page (household period volume is small).
- Settings UI for `fortnightAnchor` (set-once seed row per design).

## Approach

Six + one phases, each a shippable vertical slice in the repo's plain-router style (adr012). Phases 1–4 execute the two adopted 2026-08-11 plans: expenseId (schema → migration → router + Zod test → form UI), then expenseCategoryId likewise. Phase 5 builds the Unplanned server layer (app_setting + seeded anchor, period-window pure functions, `unplanned` query, `linkExpense` mutation), Phase 6 the page, Phase 7 the nav. Zod inputs live in a new `transaction.dto.ts` (adr005 dash convention) and are TDD'd; joins are manual `leftJoin` per the `category.ts:27` precedent. Vocabulary per `CONTEXT.md`: Planned/Unplanned, Spend/Inflow, Expense Category.

## Phase 1: Data layer — `transaction.expenseId`

Executes plan `2026-08-11-transaction-expense-mapping.md` Phase 1.

### Changes
- `src/domain/transactions/transaction.dto.test.ts` — new, **written first** (TDD): `transactionInput` accepts an int `expenseId`, `null`, and omitted; rejects a string and a float. Mirrors pure-unit style of `src/lib/utils.test.ts`.
- `src/domain/transactions/transaction.dto.ts` — new; move `transactionInput` here from `src/server/api/routers/transaction.ts:25-33`; add `expenseId: z.number().int().nullable().optional()`; export.
- `src/server/transactions/transactions.schema.ts` — import `expenses` from `~/server/expenses/expenses.schema` (lazy-thunk cross-file FK, adr005); add nullable `expenseId: d.integer().references(() => expenses.id, { onDelete: "set null" })` to the columns (`:6-19`).
- `drizzle/0002_*.sql` — `make db_generate`; review: only `ADD COLUMN "expenseId"` + FK `ON DELETE set null`, nothing else; `make db_migrate`.
- `src/server/api/routers/transaction.ts` — import `transactionInput` from `~/server/transactions/transactions-schemas`; `create` (`:158-166`) sets `expenseId: input.expenseId ?? null`; `update` (`:168-178`) carries it through `set(...)`; `list` items query (`:78-84`) becomes `.select({ ...getTableColumns(transactions), expenseName: expenses.name }).from(transactions).leftJoin(expenses, eq(transactions.expenseId, expenses.id))` keeping existing where/orderBy/limit/offset (`getTableColumns` from `drizzle-orm`). Count query (`:85-88`) unchanged.
- `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` — implements this decision; flip `Status:` to `Accepted` when this phase lands.

### Success
**Automated**
- [x] `make test` passes (new schema test green — 5 new + 26 total)
- [x] `make check` passes (includes `db:check`)
- [x] `make build` passes (code compiles clean; plain `make build` needs prod env vars locally — verified via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase)
- [x] One migration only adds `transaction.expenseId` + FK; applied on the **feature-branch** DB (never main/prod) — `drizzle/0002_silly_terror.sql`, Neon branch `local/expense-linking-stage-1`
- [x] Transaction created with `expenseId` persists it; deleting that expense sets it `NULL` (row survives) — verified via SQL probe against branch DB

## Phase 2: UI — expense picker and list column

Executes plan `2026-08-11-transaction-expense-mapping.md` Phase 2 (line numbers refreshed).

### Changes
- `src/app/(dashboard)/transactions/page.tsx` — add `void api.expense.list.prefetch()` (`:6-11`) so the new suspense query hydrates without a flash.
- `src/app/_components/transactions/transactions-view.tsx` — `api.expense.list.useSuspenseQuery()` beside the category query (`:65-69`); pass `expenses` prop to `<TransactionForm>` (`:358-363`); add "Expense" `<th>` (`:221-238`) and a `<td>` rendering `tx.expenseName ?? "—"` (`:251-300`); bump empty-state `colSpan` 6 → 7 (`:308`).
- `src/app/_components/transactions/transaction-form.tsx` — add `expenses: RouterOutputs["expense"]["list"]` to props (`:47-57`); `expenseId` string state seeded from `transaction?.expenseId` in the open effect (`:78-87`); render a `SelectField` (already imported, `:31-35`) with "— None —" (value `""`) then one option per expense (`value={String(e.id)}`, label `e.name`); submit payload (`:107-120`) adds `expenseId: expenseId ? Number(expenseId) : null`.

### Success
**Automated**
- [x] `make check` passes
- [x] `make build` passes (compiles clean; plain `make build` needs prod env locally — verified via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase)
- [x] Pick expense → save → reopen: persists; "— None —" clears it; list shows name or "—" — verified live in `/design-review`
- [x] `/design-review` — no blockers/high; two nitpicks fixed (`<th>` structure, `FieldOptional` accessible name)

## Phase 3: Data layer — `transaction.expenseCategoryId`

Executes plan `2026-08-11-transaction-expense-category-fk.md` Phases 1–2.

### Changes
- `src/domain/transactions/transaction.dto.test.ts` — **written first**: `transactionInput` accepts `expenseCategoryId` as positive int / `null` / omitted; rejects string and non-integer.
- `src/domain/transactions/transaction.dto.ts` — add `expenseCategoryId: z.number().int().nullable().optional()`.
- `src/server/transactions/transactions.schema.ts` — import `expenseCategories` from `~/server/expenses/categories.schema`; add nullable `expenseCategoryId: d.integer().references(() => expenseCategories.id, { onDelete: "set null" })`; add `index("transaction_expense_category_idx").on(t.expenseCategoryId)` to the index list (`:21-24`).
- `drizzle/0006_*.sql` — `make db_generate` (add-column + FK + index only), review, `make db_migrate`.
- `src/server/api/routers/transaction.ts` — `create`/`update` need no extra handling (value flows through the input spread); `list` items query adds `expenseCategoryName: expenseCategories.name` to the projection and a second `.leftJoin(expenseCategories, eq(transactions.expenseCategoryId, expenseCategories.id))`.

### Success
**Automated**
- [x] `make test` passes (7 new expenseCategoryId cases green — 93 total)
- [x] `make check` passes (includes `db:check`; generated meta files formatted via `make fix`)
- [x] `make build` passes (compiles clean via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase)
- [x] FK + index present on feature-branch DB — `transaction_expenseCategoryId_expense_category_id_fk` (`confdeltype=n` = ON DELETE SET NULL) + `transaction_expense_category_idx`; migration `drizzle/0006_overrated_james_howlett.sql` (0003 was consumed by Phase 1's index)
- [x] `transaction.list` projection carries `expenseCategoryId` (via `getTableColumns`) + `expenseCategoryName` (via second `leftJoin`); `TransactionListItem` interface + build type-check confirm both null when unset

## Phase 4: UI — managed category picker

Executes plan `2026-08-11-transaction-expense-category-fk.md` Phase 3.

### Changes
- `src/app/_components/transactions/transaction-form.tsx` — `const { data: managedCategories } = api.category.list.useQuery();` (dynamic-select precedent: `src/app/_components/expenses/expense-form.tsx:26-29,95-109`); `expenseCategoryId` state seeded in the open effect (`:78-87`) from `transaction?.expenseCategoryId ?? null`; `SelectField` labelled "Expense category" — "None" (value `""`) + one option per managed category (`value={String(c.id)}`, label `c.name`); include in submit payload (`:107-120`). Categories are chosen from the managed list, never invented mid-entry (glossary rule).
- `src/app/_components/transactions/transactions-view.tsx` — show `expenseCategoryName` as modest secondary text in the category `<td>` (`:264-266`); layout detail deferred to the frontend-design skill.

### Success
**Automated**
- [x] `make check` passes
- [x] `make build` passes (compiles clean via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase)
- [x] Pick managed category → save → visible in list; edit preselects; "None" clears; empty managed list still submits — verified live in `/design-review`
- [x] `/design-review` — one High (list secondary text failed WCAG AA contrast) fixed by dropping `/70`; Medium loading-flash a non-issue (parent's `category.list` suspense query warms the cache); nitpicks systemic/pre-existing, left per scope

## Phase 5: Unplanned server layer — `app_setting`, period windows, queries

### Changes
- `src/server/settings/settings.schema.ts` — new domain schema (picked up by the `./src/server/**/*.schema.ts` glob): `app_setting` table — `key` text PK, `value` text not null.
- `drizzle/0007_hot_tempest.sql` — `make db_generate` (creates `app_setting` only), review, `make db_migrate`. (Landed as 0007, not 0004: intervening enum/index migrations consumed 0004–0006.)
- Seed — manual one-time row `('fortnightAnchor', '<household payday ISO date>')` on the branch DB (and prod on release); no settings UI. A missing row degrades the picker to month-only (design: degrade, never error).
- `src/lib/period.test.ts` — new, **written first**, table-driven: `monthWindow(ref)` start/end incl. year boundary; `fortnightWindow(anchor, ref)` grid math — ref on the anchor day, mid-window, before the anchor date, many fortnights later; windows are half-open `[from, to)`; `shiftWindow` prev/next stepping.
- `src/lib/period.ts` — new pure functions used by client (and by stage-3 bucketing later): `monthWindow`, `fortnightWindow`, `shiftWindow`.
- `src/domain/transactions/transaction.dto.test.ts` — **written first**: `unplannedInput` accepts `{from, to}` dates, rejects missing/invalid; `linkExpenseInput` accepts `{id: int, expenseId: int|null}`, rejects float/string ids.
- `src/domain/transactions/transaction.dto.ts` — add `unplannedInput` (`{ from: z.date(), to: z.date() }`) and `linkExpenseInput` (`{ id: z.number().int(), expenseId: z.number().int().nullable() }`).
- `src/server/api/routers/setting.ts` — new plain router: `fortnightAnchor` protected query → the `app_setting` row's value as a validated `YYYY-MM-DD` **string** (client parses to local midnight via `fromDateInput`), or `null` when absent/malformed. Returns a string, not a `Date`: a `Date` serialises to a UTC instant and the client re-reads its calendar date in the browser tz, walking behind-UTC users a day early — the same drift `toDateInput` avoids.
- `src/server/api/root.ts` — register the `setting` router.
- `src/server/api/routers/transaction.ts` — `unplanned` query (input `unplannedInput`): all columns where `isNull(transactions.expenseId)` and `date >= from AND date < to`, ordered `category` asc then `date` desc — returns unlinked **Spend** only (`amount > 0 AND expenseId IS NULL`, per adr010; refunds are Inflow, excluded); no pagination. `linkExpense` mutation (input `linkExpenseInput`): `update ... set({ expenseId })` by id.

### Success
**Automated**
- [x] `make test` passes (period tables + new input schemas green — 121 total)
- [x] `make check` passes (generated drizzle meta formatted via `make fix`)
- [x] `make build` passes (compiles clean via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase)
- [x] `unplanned` returns only unlinked **Spend** rows inside the window; linked rows absent; refund rows absent (final decision is Spend-only, `gt(amount,0)`, adr010 — supersedes the earlier "refund rows present" wording) — confirmed live in `/design-review` (populated Unplanned page against branch DB) + `gt(amount,0)` filter code-verified
- [x] `linkExpense` sets/clears `expenseId` — confirmed live in `/design-review`: linking a row removes it from the derived view
- [x] `/security-review` (phase touches `src/lib/**`) — no findings; new paths are parameterized drizzle + Zod + `protectedProcedure`

## Phase 6: Unplanned page

### Changes
- Read the routing guide in `node_modules/next/dist/docs/` before writing the page — this Next.js version has breaking changes (AGENTS.md).
- `src/app/(dashboard)/expenses/unplanned/page.tsx` — new; mirrors `src/app/(dashboard)/expenses/page.tsx:4-11`: `void api.expense.list.prefetch()` + `void api.setting.fortnightAnchor.prefetch()`, then `<HydrateClient><UnplannedView /></HydrateClient>`. The `transaction.unplanned` query itself is a client `useQuery` (date-valued input; server prefetch can't reliably match the client-computed window).
- `src/app/_components/expenses/unplanned-view.tsx` — new client view:
  - anchor via `api.setting.fortnightAnchor.useSuspenseQuery()` (a `YYYY-MM-DD` string or null); parse it to a local-midnight `Date` with `fromDateInput` before feeding `fortnightWindow`; period state defaults to fortnight when anchor exists, else month (fortnight option hidden without anchor); window computed with `src/lib/period.ts`; prev/next via `shiftWindow`.
  - `api.transaction.unplanned.useQuery({ from, to })`; group rows by free-text `category` mirroring the `groups` memo at `src/app/_components/expenses/expenses-view.tsx:40-56` (managed `sortOrder` ordering); group total = `sum(amount)` (all rows are Spend, so the sum is a plain positive total).
  - rows: date, description, amount, inline "link to expense" `SelectField` fed by `api.expense.list.useSuspenseQuery()` → `linkExpense.mutate`; `onSuccess` invalidates `transaction.unplanned` and `transaction.list` — the linked row leaves the view by definition (Unplanned is derived, adr010).
  - empty states: no unlinked rows in window ("all Spend is planned"); no anchor → month-only picker.

### Success
**Automated**
- [x] `make check` passes
- [x] `make build` passes (compiles clean via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase; `/expenses/unplanned` route registered)
- [x] Unlinked Spend rows appear grouped with totals; linking a row removes it — confirmed live in `/design-review` (populated Unplanned page)
- [x] Refund (negative, unlinked) does NOT appear on Unplanned (Spend-only, adr010) — enforced by the `gt(amount,0)` server filter (code-verified; not independently exercised with a refund row in-browser)
- [x] Fortnight/month toggle + prev/next windows behave; anchor row absent → month-only — toggle confirmed live in `/design-review`; month-only degrade is code-verified (`fortnightAnchor` null path)
- [x] `/design-review` — ship-ready, no blockers; two defects found and fixed during validation (missing `aria-current` on nav links; error card dimmed on retry). UX/a11y refinements logged in the validation report, deferred as out-of-scope enhancements

## Phase 7: Nav restructure

### Changes
- `src/app/_components/app-nav.tsx` — extend the flat `links` array (`:22-28`) with an optional `children` field; entries become: Overview `/` · **Expenses** section — Planned `/expenses` (label "Planned", not "Budgeted" — glossary), Unplanned `/expenses/unplanned`, Categories `/expenses/categories` · Income `/income` · Transactions `/transactions`. No Receipts item (stage 5). Desktop `NavLinks` (`:43-70`) renders the section label + indented children; `MobileLinks` (`:186-212`) flattens children to icon buttons. `activeHref` (`:30-41`) needs no change — longest-match already selects `/expenses/unplanned` over `/expenses`.

### Success
**Automated**
- [x] `make check` passes
- [x] `make build` passes (compiles clean via `SKIP_ENV_VALIDATION=1`, pre-existing env gap unrelated to this phase; `/expenses/unplanned` route registered)
- [x] Desktop sidebar shows Expenses → Planned/Unplanned/Categories; active state correct on all three; mobile bar reaches all pages — verified live in `/design-review`
- [x] `/design-review` — PASS on all three criteria; High (mobile `<nav>` landmark) + Medium (children `role="group"` + `aria-hidden` header) fixed; theme/sign-out mobile gap pre-existing, left per scope; child border bumped `/20`→`/30`

## Validate

- [x] `/code-review` over the whole branch — 6 findings, 4 fixed (TOCTOU 500→404 on update/linkExpense; kind/window desync; double anchor parse; `?? null` seed consistency). 2 dismissed as false positives: the "mutations lack `onError`" findings — the global `MutationCache.onError` already toasts every conflict message, so a local handler would double-toast.

### `/validate` run — 2026-08-29

- Automated suite green: `SKIP_ENV_VALIDATION=1 yarn build` (route `/expenses/unplanned` registered), `make check`, `make test` (130 pass), `make test_e2e` (no runner wired — stub).
- ADRs: adr010 + adr012 `Accepted`; adr011 correctly stays `Proposed` (stage-2, no implementing phase here). Terminology canonical (Planned/Unplanned/Categories).
- `/security-review` (auth + `src/lib/**` touched): no findings — sign-up gating keeps production closed, all new procedures `protectedProcedure`, no SQLi/XSS.
- `/design-review` (all UI surfaces, live): ship-ready, no blockers.
- Fixes applied during validation: removed 3 section-label comments in `transaction.ts` list resolver (comment-judge REMOVE); fixed 4 vacuously-passing `transactionUpdateDto` expenseId tests (spread `baseUpdate`, not `base`); added `setup`/`stop` to Makefile `.PHONY`; added `aria-current="page"` to desktop + mobile nav links; scoped Unplanned refetch dimming to the group rows so the error/recovery card no longer fades on retry.
- Deferred (out of scope, recommended follow-ups): `expense.update`/`income.update` still 500 (not NOT_FOUND) on a missing row — generalize the transaction router's update-or-404 pattern; managed-category rename doesn't touch free-text `transaction.category` grouping on Unplanned (consistent with the "free-text category not backfilled" scope); design-review UX/a11y refinements (success toast on link, field descriptions, non-sortable "Expense" header styling, combobox chevron label, mobile touch targets).

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` (stage 1 at "Build order"; carries `## Related ADRs`)
- Adopted plans (executed by Phases 1–4): `thoughts/plans/2026-08-11-transaction-expense-mapping.md`, `thoughts/plans/2026-08-11-transaction-expense-category-fk.md`
- ADRs:
  - `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` (Proposed) — implemented by Phases 1–2 (flip to Accepted); its Unplanned-by-absence driver lands in Phases 5–6
  - `docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md` (Proposed) — governs style throughout: plain routers, no 3-tier ceremony in this branch
  - `docs/adr/adr011-one-time-budgets-as-expense-kind.md` (Proposed) — **no implementing phase here by design**: stage 2 work
  - `docs/adr/adr005-per-domain-drizzle-schema-files.md` (Accepted) — schema-file, FK-thunk, and `*.dto.ts` conventions followed
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted, deferred by adr012) — composed with, not implemented
- Terminology: `CONTEXT.md` (Planned, Unplanned, Spend, Inflow, Expense Category, Basis, Timing)
- Key code: `src/server/transactions/transactions.schema.ts:6-24`, `src/server/api/routers/transaction.ts:25-33,71-95,158-178`, `src/server/api/routers/expense.ts:15-24`, `src/server/api/routers/category.ts:15-31`, `src/app/_components/transactions/transaction-form.tsx:31-35,47-57,78-87,107-120`, `src/app/_components/transactions/transactions-view.tsx:65-69,221-238,251-300,308,358-363`, `src/app/_components/expenses/expenses-view.tsx:40-56`, `src/app/(dashboard)/expenses/page.tsx:4-11`, `src/app/_components/app-nav.tsx:22-41`
