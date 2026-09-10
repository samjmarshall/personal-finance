# Expense Linking Stage 3 — Cash Flow Chart + Balance Snapshot Implementation Plan

## Context

Stage 3 of the 2026-08-16 expense-linking/receipts/cashflow design (Build order item 3): a **cash flow chart** on the Dashboard — historic actual Spend/Inflow bars plus a forward projection of Expenses + Income — with a **running balance line** anchored on a manually-maintained `balance_snapshot`, and the **Timing** (`dueDay`/`dueMonth`) form inputs that stage 2 deferred here (design decision 4/5; stage-2 Out of Scope, `thoughts/plans/2026-08-29-expense-linking-stage-2.md:30-31`). Scope is **option (a)**: chart + snapshot + Timing inputs. The Planned-page recurring "actual" column + period picker is **not** in this stage.

## Current State

- **Charts are hand-rolled CSS bars — there is no charting library.** `monthly-spend-chart.tsx` is a flex row of `<div>` bars sized by percent (`src/app/_components/dashboard/monthly-spend-chart.tsx:16-46`); no Recharts/d3/visx in `package.json`. The design's premise that a "shadcn/Recharts" stack already exists is stale.
- **Period bucketing already exists** from stage 1: `fortnightWindow(anchor, ref)`, `monthWindow(ref)`, `shiftWindow(window, kind, step)` return half-open local-date `[from, to)` windows (`src/lib/period.ts:26-58`), tested table-driven in `src/lib/period.test.ts`.
- **`app_setting` already exists** (table `src/server/settings/settings.schema.ts:5-8`, seeded in `drizzle/0002_expense_linking_stage_1.sql`), with `setting.fortnightAnchor` returning the payday as a **YYYY-MM-DD string** (not a `Date`) to dodge superjson calendar drift (`src/server/api/routers/setting.ts:15-23`). Only `balance_snapshot` is new.
- **Expense/Income already carry the projection columns** (stage 2): `kind` (`expense_kind`/`income_kind` pgEnum, `recurring | one-time`), nullable `amount`, `expectedDate`, `dueDay`, `dueMonth`, plus recurring `fortnight`/`month`/`year` figures — `src/server/expenses/expenses.schema.ts:13-23`, `src/server/income/income.schema.ts:13-23`. The DTOs already validate `dueDay` (1–31) / `dueMonth` (1–12) (`src/domain/income/income.dto.ts:15-16`, expense mirror). **No Timing input UI exists yet** — the columns are set-able through the DTO but no form field writes them.
- **Basis is not stored.** The three figures are mutually derived from one entered figure; "Basis" is a UI-only concept back-derived in the form (`thoughts/plans/2026-08-29-expense-linking-stage-2.md:9`). The projection therefore **cannot** read a stored cadence — see Approach.
- **Transaction sign** (`CONTEXT.md:109-121`): `amount > 0` = **Spend**, `amount < 0` = **Inflow**; `transaction.date` is the timestamptz x-axis column (`src/server/transactions/transactions.schema.ts:25,28`). `summary.byMonth` is spend-only and month-only (`src/server/api/routers/transaction.ts:156-163`) — not reusable for a two-direction, fortnight-capable cash flow; a new query is required.
- **Lifetime consumption per expense already exists**: `expense.consumption` returns `{ expenseId, consumed }[]`, summing linked transactions net of refunds (`src/server/api/routers/expense.ts:28-47`) — exactly the input for one-time "remaining".
- **Router/DTO conventions** (plain-router, adr012): routers in `src/server/api/routers/*.ts` use `protectedProcedure` + `ctx.db`, wired in `src/server/api/root.ts:13-19`; DTOs in `src/domain/<domain>/<domain>.dto.ts` via a shared-fields object + barrel `index.ts`, interfaces in `<domain>.interface.ts` (income is the simplest template — `src/server/api/routers/income.ts`, `src/domain/income/income.dto.ts`, `src/domain/income/income.interface.ts`). Enums are TS string enums in `src/lib/constants.ts` bridged to `pgEnum(Object.values(Enum) as [...])`.
- **tRPC transformer is superjson** (`src/server/api/trpc.ts:48`, `src/trpc/react.tsx:53`) — `Date` survives the wire but as a UTC instant, which walks a **calendar** day for behind-UTC clients (the drift `setting.fortnightAnchor` returns strings to avoid).
- **DB/driver:** postgres.js (`src/server/db/index.ts`), migrations two-step `make db_generate` → `make db_migrate` (**user-run**), never `drizzle-kit push`; latest migration `drizzle/0003_expense_income_kind_timing.sql`, next index `0004`. On `main` `DATABASE_URL` is production — do all migration/write work on a **stage-3 feature branch**.
- **Formatting helpers** ready to reuse: `<Money>` (`src/app/_components/money.tsx`), `formatCurrency`/`formatCompact` (`src/lib/utils.ts:8-20`), `formatDate`/`formatMonthKey` (`src/lib/utils.ts:41-45`, plus month formatter), `toDateInput`/`fromDateInput` (`src/lib/utils.ts:50-75`), `isPast` (`:80-84`).
- **shadcn is on Base UI** (adr008; `components.json` style `base-nova`, `shadcn` 4.16.2 devDep; primitives import `@base-ui/react/*`). The shadcn `chart` block is a standalone Recharts wrapper with `"use client"` — **no** Radix/Base UI dependency, so it drops in cleanly.

## Desired End State

- A new `balance_snapshot` table (`amount`, `asOf`) + `balance` router (`latest` read, `set` mutation that records a new snapshot row) in one applied, git-tracked migration `0004`.
- A **pure, fully-tested projection core** `buildCashflow(...)` in `src/domain/cashflow/` that, given `now`, a `PeriodKind`, the fortnight anchor, transactions, expenses, income, per-expense consumption, and the latest balance snapshot, returns 25 buckets (12 back · current · 12 forward) each carrying `spend`, `inflow`, `balance | null`, contributing `items[]`, and an `isCurrent` flag — with the design's projection rules (spike/smear, one-time remaining roll-forward, one-time income drop-out, today-straddle date-split, pivot balance line) exercised by table-driven tests.
- A thin `cashflow.get` query (`periodKind` input, default fortnight) that loads the rows, calls `buildCashflow`, and returns buckets **keyed by YYYY-MM-DD string** (no `Date` over the wire).
- A Dashboard **cash flow chart** (Recharts `ComposedChart` via the shadcn `chart` primitive): Inflow bars up, Spend bars down, balance line overlay, a "today" reference line, a per-bucket tooltip listing contributing items, dip-below-zero buckets tinted as a warning, and a fortnight/month toggle. Beside it, a **balance snapshot card** with an inline "update balance" field.
- **Timing inputs** (`dueDay`/`dueMonth`) on the Expense and Income forms, driving the projection spikes.
- No new ADR: stage 3 implements design decisions 4/5/10, none of which the design elevated to a Proposed ADR. It composes with adr012 (plain routers), adr005 (per-domain schema), adr008 (shadcn on Base UI).

## Out of Scope

- **Planned-page recurring "actual" column + period picker** (design "Planned page"; stage-2 deferred). Not in option (a); a later stage. This plan adds no period picker to `/expenses`.
- Outbox/Inngest, CDR/PayPal `provenance`, receipts/email — stages 4–6.
- Per-account balances (`balance_snapshot` is one household-wide number; design decision 5), a settings UI for `fortnightAnchor`, and `householdId` scoping.
- Any service/repository/module tier — adr012 keeps feature work plain-router. (Aside: `.claude/rules/server-architecture.md` describes a 3-tier `<domain>.router.ts` architecture with domains — leads/hubspot/messaging/twilio — that **do not exist in this repo**; it is inherited fiction. Flag for a separate rules cleanup; do not follow it here.)
- Changing `expense.consumption`'s shape or `monthly-spend-chart` (untouched).

## Approach

Four vertical slices in plain-router style (adr012), each shipping alone.

**Phase 1** adds the `balance_snapshot` data layer (schema + DTO + interface + `balance` router + migration `0004`), mirroring the income domain — the projection's balance anchor.

**Phase 2** is the risk core: a pure `buildCashflow(...)` in `src/domain/cashflow/`, built as a TDD vertical-slice loop (one test → one impl) over small sub-functions, then a thin `cashflow.get` router that loads rows and returns string-keyed buckets. **Cadence is keyed on Timing, not Basis** (a deliberate reconciliation of design decision 4 — Basis is not stored):
- `dueMonth` set → **annual spike**: the `year` figure lands once, in the bucket containing `(dueMonth, dueDay ?? 1)`, `dueDay` clamped to month-end (29–31 never rolls forward).
- `dueDay` set, `dueMonth` null → **monthly spike**: the `month` figure lands each month in the bucket containing `dueDay` (clamped to month-end).
- neither → **smear**: the `year` figure prorated by `bucketDays / daysInYear`, per bucket. This is bucket-kind-agnostic and conserves the annual total (≈ `fortnight` figure per fortnight bucket, ≈ `month` figure per month bucket), so it subsumes the design's "fortnight-basis → every grid fortnight" and "untimed → smear" cases in one rule; only *timed* rows spike.

One-time Expense → **remaining** (`amount − consumed`) in `expectedDate`'s bucket; a past-date, still-unconsumed remaining **rolls into the current bucket** (never silently drops). One-time Income → full `amount` in `expectedDate`'s bucket; a past-date one-time income **drops out** (assumed received — asymmetric with expenses per decision 10, no FK to measure receipt). The today-straddling bucket is **date-split**: actual transactions for `[from, now]` plus projected items landing strictly after `now` (smears prorated to remaining days; spikes included only if their landing date `> now`) — killing the salary/rent double-count. The balance line pivots on the latest snapshot's `asOf`: forward = anchor + cumulative projected net; backward = anchor − actual net; no snapshot → bars only.

**Phase 3** builds the Dashboard UI (adds `recharts` + `yarn shadcn add chart`), consuming `cashflow.get` and `balance.latest`/`balance.set`.

**Phase 4** adds the Timing inputs to the Expense and Income forms (DTO/columns already exist — pure form work), whose visible effect is the recurring spikes now appearing in the Phase-3 chart.

Vocabulary per `CONTEXT.md`: **Spend**/**Inflow** (never positive/negative for direction), **Timing** (`dueDay`/`dueMonth`, "when a commitment lands"), **Basis** (UI-only cadence, not stored), `recurring`/`one-time`.

## Phase 1: `balance_snapshot` data layer + `balance` router

### Changes

- `src/server/balances/balances.schema.ts` — **new** per-domain schema (adr005). `export const balanceSnapshots = pgTable("balance_snapshot", (d) => ({ id: integer PK generatedByDefaultAsIdentity, amount: d.doublePrecision().notNull(), asOf: d.timestamp({ withTimezone: true }).notNull(), createdAt: d.timestamp({ withTimezone: true }).$defaultFn(() => new Date()).notNull() }))`. One household-wide figure per row; the latest by `asOf` (tiebreak `id` desc) anchors the projection (design decision 5). Discovered by the `./src/server/**/*.schema.ts` glob automatically.
- `src/domain/balances/balance.interface.ts` — **new**: `export interface BalanceSnapshot { id: number; amount: number; asOf: Date; createdAt: Date }`.
- `src/domain/balances/balance.dto.ts` — **new**: `balanceSetDto = z.object({ amount: z.number(), asOf: z.date() })`. `amount` is unsigned-free (a household balance can be negative). `asOf` as `z.date()` follows the in-repo `expectedDate` precedent (`src/domain/income/income.dto.ts:14`), seeded/submitted through `toDateInput`/`fromDateInput` in the form.
- `src/domain/balances/index.ts` — **new** barrel re-exporting the dto + interface (mirrors `src/domain/income/index.ts`).
- `src/server/api/routers/balance.ts` — **new** plain router:
  - `latest: protectedProcedure.query(): Promise<BalanceSnapshot | null>` — `select().from(balanceSnapshots).orderBy(desc(asOf), desc(id)).limit(1)`, return `row ?? null`.
  - `set: protectedProcedure.input(balanceSetDto).mutation(): Promise<BalanceSnapshot>` — `insert(...).values(input).returning()` (records a **new** snapshot; "update balance" keeps history, latest wins), `assertRow(row, "set balance")` (`src/server/api/lib/assert-row.ts`).
- `src/server/api/root.ts` — register `balance: balanceRouter` (import + key, `:1-19`).
- `src/server/balances/balances.schema.test.ts` — **written first**: `getTableColumns` asserts `amount.notNull === true`, `asOf.notNull === true`, `createdAt.hasDefault === true` (mirrors `src/server/income/income.schema.test.ts`).
- `src/domain/balances/balance.dto.test.ts` — **written first**: `balanceSetDto` accepts `{ amount, asOf: Date }`, accepts negative `amount`, rejects a missing/non-date `asOf`, rejects a non-number `amount`; a compile-time `WritesInto<BalanceSet, BalanceSnapshot insert>` contract using `src/test/type-contracts.ts`.
- `drizzle/0004_balance_snapshot.sql` — `make db_generate`; review it is a single `CREATE TABLE "balance_snapshot"` (no cast, no backfill), optionally rename to `0004_balance_snapshot`; then `make db_migrate` (**user-run**, feature-branch DB).

### Success
**Automated**
- [x] `make check` passes (includes `db:check`; the `WritesInto` contract compiles)
- [x] `make test` passes (new schema-default + DTO cases green)
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [x] Migration generated + applied on the **feature-branch** DB (never main/prod): `balance_snapshot` exists with `amount`/`asOf`/`createdAt` — verified via SQL probe on the branch. _(generated as `0004_balance_snapshot.sql`; **apply is user-run** — `make db_migrate`)_
- [x] `balance.set` inserts a row and `balance.latest` returns it; a second `set` with a later `asOf` becomes the new `latest`. _(verified against branch DB: insert returns id+createdAt, latest follows asOf desc, tiebreak id desc, negative amount stored)_

## Phase 2: projection core (`src/domain/cashflow/`) + `cashflow.get`

Built as a TDD vertical-slice loop (see the `tdd` skill): each sub-function below is one test-table → one implementation step, composed last into `buildCashflow`. All arithmetic is on local calendar dates, reusing `src/lib/period.ts` (never re-implement window math).

### Changes

- `src/domain/cashflow/cashflow.interface.ts` — **new** return shape:
  ```ts
  export interface CashflowItem { label: string; amount: number } // amount signed: + Spend, − Inflow
  export interface CashflowBucket {
    key: string;        // YYYY-MM-DD of bucket.from (wire-safe, ordering + x-axis)
    label: string;      // display label, formatted server-side ("14 Aug" / "Aug")
    spend: number;      // ≥ 0
    inflow: number;     // ≥ 0
    balance: number | null; // running balance; null when no snapshot anchor
    isCurrent: boolean; // the today-straddling bucket (today marker)
    items: CashflowItem[]; // tooltip contributors
  }
  export interface CashflowResult { buckets: CashflowBucket[]; hasBalanceAnchor: boolean }
  ```
- `src/domain/cashflow/cashflow.dto.ts` — **new**: `cashflowQueryDto = z.object({ periodKind: z.enum(["fortnight", "month"]).default("fortnight") })` (`PeriodKind` mirrors `src/lib/period.ts:5`).
- `src/domain/cashflow/index.ts` — **new** barrel (dto + interface + `buildCashflow` + its input type).
- `src/domain/cashflow/cashflow.ts` — **new** pure core. Signature:
  ```ts
  buildCashflow(input: {
    now: Date;
    periodKind: PeriodKind;
    fortnightAnchor: Date | null;        // null + fortnight → fall back to month grid
    transactions: { date: Date; amount: number }[];
    expenses: Expense[];                  // ~/domain/expenses
    incomes: Income[];                    // ~/domain/income
    consumedByExpenseId: Map<number, number>;
    anchor: { amount: number; asOf: Date } | null;
  }): CashflowResult
  ```
  Internal, individually-tested helpers:
  - `buildGrid(now, periodKind, fortnightAnchor)` → 25 `PeriodWindow`s (12 back · current · 12 forward) via `monthWindow`/`fortnightWindow` + `shiftWindow` (`src/lib/period.ts:26-58`). When `periodKind === "fortnight"` and `fortnightAnchor == null`, degrade to the month grid (design "missing cadence → degrades, never errors").
  - `actualsFor(window, transactions)` → `{ spend, inflow, items }` summing `amount > 0` into `spend`, `|amount < 0|` into `inflow` (`CONTEXT.md:109-121`).
  - `projectRecurring(row, window, now)` → signed amount for a recurring Expense/Income in a window, applying the **Timing-keyed** spike/smear rules from Approach (`dueMonth`→annual `year`; `dueDay`→monthly `month` clamped to month-end; else smear `year × bucketDays/daysInYear`). Month-end clamp: `min(dueDay, daysInMonth(year, month))` — 29–31 never roll into the next month.
  - `projectOneTime(row, window, now, consumed)` → Expense: `remaining = max(amount − consumed, 0)` in `expectedDate`'s bucket; if `expectedDate < today` and `remaining > 0`, place it in the **current** bucket instead. Income: full `amount` in `expectedDate`'s bucket; if `expectedDate < today`, contribute nothing (drop-out).
  - `splitCurrentBucket(window, now, ...)` → for the `isCurrent` bucket: actuals over `[from, now]` + projected items whose landing date is strictly `> now` (smears prorated by remaining-days ÷ bucket-days; spikes gated on landing `> now`).
  - `balanceLine(buckets, anchor)` → walk from the bucket containing `anchor.asOf`: forward `balance[i] = balance[i-1] + inflow − spend` of the projected net; backward `balance[i] = balance[i+1] + (actual spend − actual inflow)`. `null` for every bucket when `anchor == null`.
- `src/domain/cashflow/cashflow.test.ts` — **written first, table-driven** (the design's highest-risk logic, `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md:132-134`). Cases, each a separate `it.each` table with a fixed `now` and a readable window formatter à la `period.test.ts:12-13`:
  - **Grid:** 25 buckets, ordered, `isCurrent` on the window containing `now`; fortnight-anchor-null degrades to month grid.
  - **Historic actuals:** Spend sums positives, Inflow sums `|negatives|`; a bucket with both nets correctly into two figures (not one).
  - **Recurring spike — annual:** `dueMonth`=6 → full `year` in June's bucket, 0 elsewhere; `dueDay`=31 in a 30-day due month clamps to the 30th (no roll into next month).
  - **Recurring spike — monthly:** `dueDay`=15 → `month` figure in each month's bucket; `dueDay`=31 clamps per month.
  - **Smear:** untimed recurring → `year × days/daysInYear` per bucket; the 25-bucket sum over a year ≈ `year` (conservation, within rounding); ≈ `fortnight` per fortnight bucket / ≈ `month` per month bucket.
  - **One-time Expense remaining:** `remaining = amount − consumed` in the future bucket; fully-consumed → 0; a **past** `expectedDate` with remaining > 0 rolls into the current bucket; past + fully consumed → nothing.
  - **One-time Income:** full amount in a future bucket; a **past** `expectedDate` drops out (0 everywhere).
  - **Today-straddle:** current bucket = actuals for elapsed days + a projected spike due later this bucket; a spike whose landing ≤ `now` is excluded (already in actuals); an untimed smear prorates to remaining days.
  - **Balance line:** pivot at `anchor.asOf`; forward accumulates projected net, backward subtracts actual net, continuous across the pivot; `anchor == null` → every `balance` is `null` and `hasBalanceAnchor === false`.
- `src/server/api/routers/cashflow.ts` — **new** thin plain router. `get: protectedProcedure.input(cashflowQueryDto).query(): Promise<CashflowResult>`:
  - Load in parallel (`Promise.all`): `transactions` (`{ date, amount }`, all rows — a household's volume is small; the projection windows client-side), `expenses` (all), `income` (all), consumption (`{ expenseId, consumed }[]` — the same select as `expense.consumption`, `src/server/api/routers/expense.ts:30-40`, inlined here; two 4-line uses don't warrant a cross-router helper), `fortnightAnchor` (the app_setting read, `src/server/api/routers/setting.ts:17-22`), latest `balance_snapshot`.
  - Build `consumedByExpenseId` Map, parse `fortnightAnchor` via `fromDateInput`, call `buildCashflow({ now: new Date(), ... })`, return its `CashflowResult` (buckets already carry **string** `key`/`label` — no `Date` crosses the wire).
- `src/server/api/root.ts` — register `cashflow: cashflowRouter`.

### Success
**Automated**
- [x] `make test` passes — the `cashflow.test.ts` tables (spike/clamp/smear/one-time roll-forward/income drop-out/today-straddle/balance-pivot) all green
- [x] `make check` passes (db:check; `cashflow.get` return type matches `CashflowResult`)
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)
- [x] `cashflow.get` (server caller or a temporary log) returns 25 buckets with plausible spend/inflow and a balance line when a snapshot exists; bars-only (`balance: null`) when none. _(needs the feature-branch DB + an authed session — **user-run**, or exercised live by the Phase 3 chart render.)_

## Phase 3: Dashboard cash flow chart + balance snapshot card

### Changes

- Add `recharts` (v3.3.0) to dependencies (`make install` / `yarn add recharts`) and run `yarn shadcn add chart` → `src/components/ui/chart.tsx` (standalone Recharts wrapper, `"use client"`, Base-UI-safe; exports `ChartContainer`, `ChartConfig`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend*`, `ChartStyle`). Verify the generated file lands under `~/components/ui` per `components.json` aliases.
- `src/app/_components/dashboard/cash-flow-chart.tsx` — **new** `"use client"` component. `const [data] = api.cashflow.get.useSuspenseQuery({ periodKind })` with a `periodKind` toggle (fortnight | month) using the existing `Select`/toggle primitive (`src/components/ui/select.tsx`). Render a Recharts `ComposedChart` inside `ChartContainer`:
  - Two `Bar`s: `inflow` (up, positive data) and `spend` (drawn **down** — supply spend as a negative series value, or a second axis-relative bar; Recharts diverges around `y=0` automatically). Colors from the theme tokens `--color-positive` (Inflow) and `--color-spend` (Spend) already in `src/styles/globals.css:165-167`, surfaced through `ChartConfig`.
  - A `Line` (`type="monotone"`, `dot={false}`) for `balance`, hidden when `hasBalanceAnchor === false`.
  - `<ReferenceLine y={0} />` baseline and `<ReferenceLine x={currentKey} label="Today" />` on the `isCurrent` bucket's `key`.
  - Dip-below-zero warning tint via a per-bar `shape` render prop (Recharts v3 — `Cell` is deprecated), colouring a bar whose bucket `balance < 0`.
  - A custom tooltip (`ChartTooltip content={<ChartTooltipContent .../>}` or a small custom renderer) listing the bucket's `items` ("Car insurance $1,400 · Rates $600…") via `formatCurrency`.
  - Empty/degraded states: mirror `monthly-spend-chart.tsx:8-14` (a centered message when `buckets` are all zero).
- `src/app/_components/dashboard/balance-snapshot-card.tsx` — **new** `"use client"` component. `const [latest] = api.balance.latest.useSuspenseQuery()`; show `<Money tone="ledger" value={latest?.amount} />` + `formatDate(latest?.asOf)` (or "Set your balance" when null). An inline field (`Input` + `Button`, `src/components/ui/input.tsx`) submitting `api.balance.set` with `{ amount, asOf: new Date() }` and invalidating `balance.latest` + `cashflow.get` on success (the line re-anchors). Reuse the number-input + submit pattern from the expense form.
- `src/app/(dashboard)/page.tsx` — insert a new full-width row **between the KPI grid (`:109`) and the existing chart row (`:111`)**: a `grid grid-cols-1 gap-4 lg:grid-cols-3` (mirroring `:111`) with `<CashFlowChart />` in an `lg:col-span-2` `Card` titled "Cash flow" and `<BalanceSnapshotCard />` in the narrow `Card` beside it. Add `void api.cashflow.get.prefetch({ periodKind: "fortnight" })` and `void api.balance.latest.prefetch()` to the page's prefetch/`Promise.all` (`:19-23`). Card scaffolding copied from `:112-127`.

### Success
**Automated**
- [x] `make check` passes (recharts types resolve; `chart.tsx` lints clean) _(needed `react-is@19.2.0` — recharts v3 imports it but doesn't bundle it; two generated-file lints fixed: array-index keys + a justified `dangerouslySetInnerHTML` ignore)_
- [x] `make test` passes _(190 pass)_
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)
- [x] Chart renders 25 buckets: Inflow bars up, Spend bars down, a "Today" marker on the current bucket, and a balance line when a snapshot exists (bars-only when not). Hover shows a bucket's contributing items; a below-zero bucket is tinted. _(verified live via /design-review; caveats: busy-bucket tooltip overflows the card, and the below-zero tint also recolors the Inflow bar — see Code Review Findings)_
- [x] Toggling fortnight ⇄ month re-buckets the chart (grid switches, today marker stays on the current bucket). _(verified; minor: transient Recharts 0×0 warning during the toggle)_
- [x] The inline balance field records a snapshot → the card updates and the balance line re-anchors on refetch. _(verified live: save → card + balance line re-anchor via cache invalidation)_
- [x] `/design-review` (UI change; check both light/dark tokens and mobile 375px). _(run as /design-review &lt;plan&gt;; no blockers; 2 high-priority polish items, dark-mode + 375px checked)_

## Phase 4: Timing (`dueDay`/`dueMonth`) inputs on Expense + Income forms

DTO validation and columns already exist (stage 2); this is pure form UI whose visible effect is the recurring spikes now appearing in the Phase-3 chart.

### Changes

- `src/app/_components/expenses/expense-form.tsx` — for the **recurring** kind only (one-time uses `expectedDate`, not Timing), add two optional Timing inputs: a **Due day** (1–31) and a **Due month** (1–12; label it as the annual-spike control). Seed from `expense?.dueDay`/`dueMonth` in the open effect (near the existing `expectedDate` seed `:83`), default empty → submit `null`. Extend the recurring submit `payload` (`:126-138`) with `dueDay`/`dueMonth`. Copy the number-field markup already used for Amount; keep them hidden when `kind === one-time`.
- `src/app/_components/income/income-form.tsx` — the same two Timing inputs (payday semantics), seeded from `income?.dueDay`/`dueMonth`, added to the recurring submit `payload`.
- No schema, DTO, interface, or router change — `dueDay`/`dueMonth` already validate (`src/domain/income/income.dto.ts:15-16`) and flow through the spread `input` into `.values()`/`.set()`.

### Success
**Automated**
- [x] `make check` passes
- [x] `make test` passes (190 pass)
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)
- [ ] Set `dueDay`=15 on a recurring monthly Expense → its `month` figure spikes on the 15th's bucket in the cash flow chart (not smeared). _(form now writes `dueDay`/`dueMonth`; spike/clamp/smear logic is green in `cashflow.test.ts` — live chart confirmation is **user-run**, needs authed session + branch DB.)_
- [ ] Set `dueMonth`=6 (+ optional `dueDay`) on an annual Expense → a single June spike of the `year` figure; a `dueDay` of 31 in a 30-day month lands on the 30th (no roll-forward). _(month-end clamp covered by `cashflow.test.ts`; live confirmation **user-run**.)_
- [ ] Clearing both Timing fields returns the row to an even smear. _(recurring payload submits `dueDay`/`dueMonth` as `null` explicitly so a cleared field reverts on update; live confirmation **user-run**.)_
- [x] `/design-review` (UI change). _(run as `/design-review <plan> 4`; no blockers. Fixed: income error copy now matches Payday/Pay month labels; Timing hint linked via `aria-describedby` on both forms. Verified light/dark + 375/768/1440, add+edit, recurring-only show/hide.)_

## Validate

Run `/validate` over the whole branch (its standing `/code-review` step — do not add per-phase). Confirm: cadence keyed on Timing + stored figures (Basis is not stored) and documented; buckets cross the wire as **strings** (no `Date`); migration `0004` is additive-only and applied only on a feature-branch DB; terminology canonical (Spend/Inflow, Timing, `recurring`/`one-time`); plain-router style held (no service/repo tier); recharts + shadcn `chart` are the only new deps.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` (Build order item 3; "Cash flow chart" `:104-121`; decisions 4/5/10 `:25-31`; carries `## Related ADRs`)
- Prior plan: `thoughts/plans/2026-08-29-expense-linking-stage-2.md` (stage-2 conventions this mirrors; Out of Scope `:30-31` defers Timing UI + Planned actual column here; Basis-not-stored `:9`)
- ADRs (all Accepted; stage 3 implements **no new ADR**):
  - `docs/adr/archived/adr012-defer-adr004-plain-routers-for-feature-work.md` — governs style: plain routers, no 3-tier ceremony
  - `docs/adr/adr005-per-domain-drizzle-schema-files.md` — `balance_snapshot` goes in `src/server/balances/balances.schema.ts`; two-step migration
  - `docs/adr/adr008-shadcn-on-base-ui-for-shared-primitives.md` — shadcn `chart` (standalone Recharts wrapper) is compatible
  - `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` — the `transaction.expenseId` FK the projection sums for one-time remaining
  - `docs/adr/adr011-one-time-budgets-as-expense-kind.md` — the `kind`/`amount`/`expectedDate` the one-time projection reads
- Terminology: `CONTEXT.md` (Spend/Inflow `:109-121`; Timing `:69-72`; Basis `:64-67`; `recurring`/`one-time`)
- Library docs (verified via Context7): shadcn `chart` = single `components/ui/chart.tsx`, `"use client"`, no Radix/Base UI dep; Recharts **v3.3.0** — `ComposedChart` + `Bar` + `Line` + `ReferenceLine`, diverging bars automatic around `y=0`, per-bar colour via the `shape` prop (`Cell` deprecated in v3), custom tooltip via `content`.
- Key code: `src/lib/period.ts:26-58` (+ `period.test.ts` pattern), `src/server/settings/settings.schema.ts:5-8`, `src/server/api/routers/setting.ts:15-23`, `src/server/expenses/expenses.schema.ts:13-23`, `src/server/income/income.schema.ts:13-23`, `src/server/transactions/transactions.schema.ts:25,28`, `src/server/api/routers/expense.ts:28-47` (consumption), `src/server/api/routers/income.ts` (router template), `src/domain/income/income.dto.ts` (DTO template), `src/server/api/root.ts:13-19`, `src/app/(dashboard)/page.tsx:18-160` (insert at `:109-111`), `src/app/_components/dashboard/monthly-spend-chart.tsx` (empty-state reference), `src/app/_components/money.tsx`, `src/lib/utils.ts:8-84`, `src/app/_components/expenses/expense-form.tsx:83,126-138`, `src/app/_components/income/income-form.tsx`, `src/test/type-contracts.ts`
