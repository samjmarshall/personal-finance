---
date: 2026-10-07
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022]
status: Ready to implement
---
# tRPC 3-tier migration, step 5: cashflow — Implementation Plan

## Context

Steps 1–4 shipped. `cashflow.ts` is still a plain router. It reads five other domains' tables through `ctx.db` and repeats the consumption query that the transactions service already owns. This is migration step 5 of the design: "Cashflow. Create the folder. It calls five services and drops the copied consumption query." Cashflow becomes a top-level domain with no tables. A `CashflowService` asks the five owning services (adr022), hands their results to the pure `buildCashflow`, and is served by a thin tRPC controller (adr021). The tRPC path stays the same.

## Current State

- **The cashflow router** (`src/server/api/routers/cashflow.ts`, 78 lines). It has one procedure, `get` (`:19-77`), a `protectedProcedure` with `cashflowQueryDto` (`src/domain/cashflow/cashflow.dto.ts:5-7`, `periodKind` defaults to `"fortnight"`).
  - Six queries run in one `Promise.all` (`:22-57`):

    | # | Query | Lines | Owning service today |
    | --- | --- | --- | --- |
    | 1 | `select date, amount from transaction` | `:30-32` | none. The transactions service has no full date-and-amount read. |
    | 2 | `select * from expense`, **no order** | `:33` | `ExpensesService.list` (`expenses.service.ts:61-63`) orders by category, sort order, name (`expenses.repository.ts:62-71`) |
    | 3 | `select * from income`, **no order** | `:34` | `IncomeService.list` (`income.service.ts:20-22`) orders by person, sort order, source (`income.repository.ts:32-37`) |
    | 4 | consumption per Expense | `:35-47` | `TransactionsService.consumedByExpense` (`transactions.service.ts:106-108`). The SQL is byte-identical (`transactions.repository.ts:246-262`). The comment at `:35-36` admits the copy. |
    | 5 | the fortnight anchor value | `:48-51` | `SettingsService.fortnightAnchor` (`settings.service.ts:19-22`). Same SQL (`settings.repository.ts:29-35`). |
    | 6 | the latest balance snapshot | `:52-56` | `BalancesService.latest` (`balances.service.ts:16-18`). Same SQL (`balances.repository.ts:24-31`). |
  - Then it builds the input (`:59-76`):
    - `consumedByExpenseId` is a `Map` of the consumption rows. It needs the `as number` cast that `consumedByExpense` already does (`transactions.repository.ts:257-261`).
    - `fortnightAnchor` is `anchorValue ? fromDateInput(anchorValue) : null`. `fromDateInput` (`src/lib/utils.ts:69-82`) returns null on an invalid date. `SettingsService.fortnightAnchor` returns null on an invalid date too, so the result is the same.
    - `anchor` is `{ amount, asOf }` of the snapshot, or null.
    - `now: new Date()`.
  - It imports `drizzle-orm` and five foreign `*.schema.ts` files (`:1,9-14`).
  - **No test exists.** Nothing in `src/server/api/routers/` covers cashflow.
- **The pure compute.** `buildCashflow` (`src/domain/cashflow/cashflow.ts:51`) takes `BuildCashflowInput` (`:7-16`). Its own suite is `src/domain/cashflow/cashflow.test.ts`.
  - **Order matters for the tooltip only.** `toCommitments` (`:152-170`) keeps Expenses then Incomes in input order. `addContribution` (`:189-198`) pushes each into `bucket.items` in that order. The chart renders `items` unsorted (`src/app/(dashboard)/_components/cash-flow-chart.tsx:236`).
  - Amounts are `doublePrecision` (`expenses.schema.ts:20`, `income.schema.ts:20`, `transactions.schema.ts:28`), so a new sum order can shift the last floating-point digit.
- **Wiring**
  - `src/server/api/services.ts:28-47` builds `balances`, `income`, `settings` and `transactions` inline in the `services` object. `expenses` (`:17-19`) and `members` (`:22-24`) are local consts.
  - `src/server/api/root.ts:1` imports `cashflowRouter` from `routers/`, under the key `cashflow` (`:16`).
- **The architecture to-do list** (`src/server/architecture.test.ts:38-55`) has 16 entries. This step owns 6, all rule 3, at `:41-46`.
- **Docs**
  - `.claude/rules/server-architecture.md:144-158` lists the unmigrated routers (`cashflow, receipt`, at `:149`).
  - The tier map's service row (`:28`) says a service depends on a "`repository` + adapter interfaces". Cashflow has no repository.
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80` (Done) and `:81` (Next: "cashflow (step 5), then categories (step 6)") track progress.
  - adr021 and adr022 have no implementation log. Progress lives in adr004.
- **Precedents to mirror**
  - A controller that calls another domain's service: `expense.consumption` → `ctx.services.transactions.consumedByExpense()` (`src/server/expenses/expenses.trpc.controller.ts:9-11`).
  - `Pick` ports: `transactions.service.ts:33-45`.
  - Tests:
    - `serviceWith` (`settings.service.test.ts:12-19`). The transactions one is `transactions.service.test.ts:24-37`.
    - `callerWith` (`settings.trpc.controller.test.ts:8-12`).
    - `recorder`, `throwing`, `unstaged` (`src/test/fakes.ts:9-26`).
    - `recordingDb`, `rowOf` (`src/server/db/recording-db.fake.ts:18-64`). Match on `query.sql`, not call order (`:13-15`).
    - Date-only fake timers (`income.repository.test.ts:47-50`).
    - The repository `harness` and the `consumedByExpense` SQL snapshot (`transactions.repository.test.ts:14-20,512-529`).
    - Step 4's characterize harness (`f2d8107`).
  - Commit shape: step 4's characterize → serve → remove (`f2d8107`, `5d68c58`, `2a87771`).
- **Unaffected.** `TABLELESS` in `src/server/db/schema-interface-contract.test.ts:59` already lists `cashflow`. It scans `src/domain/`, which does not change.
- **Client callers.** None change:
  - `src/app/(dashboard)/_components/cash-flow-chart.tsx:39,87`
  - `src/app/(dashboard)/page.tsx:29`
  - `src/app/(dashboard)/_components/balance-snapshot-card.tsx:26`
  - `src/app/(dashboard)/settings/_components/pay-cycle-section.tsx:30`

## Desired End State

- **`cashflow.get` is served by `src/server/cashflow/cashflow.trpc.controller.ts` → `CashflowService`, with no repository.** The folder mirrors the kernel `src/domain/cashflow/` (design `:270-273`).
- **`CashflowService` makes no query of its own.** It calls five services through `Pick` ports, all in one `Promise.all`:
  - transactions: `datedAmounts`, `consumedByExpense`
  - expenses: `list`
  - income: `list`
  - settings: `fortnightAnchor`
  - balances: `latest`
- **The copied consumption query is gone.** Cashflow and `expense.consumption` both call `TransactionsService.consumedByExpense`.
- **`services.ts` builds each service once.** `balances`, `income`, `settings` and `transactions` become local consts, shared by their own key and by `cashflow`.
- **`src/server/api/routers/` holds only the `receipts` files.**
- **The to-do list has 10 entries.** No new entry was added.
- **The member sees one accepted change.** Tooltip items now follow the list reads' fixed order (not the Planned page, which ranks categories by their managed sort order and splits one-time items by date):
  - Expenses: category, sort order, name.
  - Income: person, sort order, source.
  - Today their order depends on where Postgres stored each row. Bucket totals stay the same, apart from a possible last-digit floating-point shift.
  - Every other value matches today's: 25 buckets, keys, labels, spend, inflow, balance, `isCurrent`, `hasBalanceAnchor`, and codes.
- `make check`, `make test` and `make build` are green.

## Out of Scope

- **Steps 6–8:** categories, receipts, `*.module.ts` files, deleting `src/server/api/lib/`, and removing `ctx.db`.
- **Changes to `buildCashflow`** or anything else in `src/domain/cashflow/`.
- **A `cashflow.module.ts`.** Only the tRPC root uses the service.
- **Putting `datedAmounts` on a tRPC path.** Only `CashflowService` calls it.
- **Keeping the unordered expense and income reads.** That needs new list methods. The deterministic order was accepted.
- **Any tRPC path, response shape or client change.**
- **Changing adr021 or adr022 `Status:`.** Both stay Proposed.

## Approach

Two phases, in step 4's shape.

1. **`TransactionsService.datedAmounts()`.** This is new code with no caller yet, so it needs no characterization. Build it by the TDD vertical-slice loop (`tdd` skill): one repository test, then its implementation, then one service test, then its implementation.
2. **Cashflow**, in three commits:
   - **Characterize.** There is no test today. Write one that pins the router's six SQL statements and its result through `recordingDb`.
   - **Serve (Commit A).** Add the service and controller, wire them in, and point the characterization test at them.
   - **Remove (Commit B).** Delete the router and its test, clear the 6 to-do entries and update the docs.

- **The proof.** The only snapshot change in Commit A is the two new `order by` clauses on the `expense` and `income` selects. The other four SQL statements and every result assertion stay byte-identical. The fake returns rows in staged order whatever the SQL says, so the result cannot drift.

## Phase 1: `TransactionsService.datedAmounts()`

One commit.

### Changes

- **`src/server/transactions/transactions.repository.ts`**
  - Add `datedAmounts(): Promise<Pick<Transaction, "date" | "amount">[]>` to the `TransactionsRepository` interface (`:38-56`). JSDoc: `` Every Transaction's date and amount: the cash flow actuals. ``
  - Implement it in `DrizzleTransactionsRepository` beside `consumedByExpense` (`:246`). Lift `select({ date: transactions.date, amount: transactions.amount }).from(transactions)` from `cashflow.ts:30-32`.
- **`src/server/transactions/transactions.repository.test.ts`.** A new `describe("datedAmounts")` after `consumedByExpense` (`:512-529`), using the existing `harness` (`:14-20`):
  - Pins the SQL in `toMatchInlineSnapshot`: `select "date", "amount" from "transaction"`, with no params.
  - A staged `[iso, 42.5]` row comes back as `{ date: Date, amount: 42.5 }`.
- **`src/server/transactions/transactions.service.ts`.** Add `datedAmounts()`, which passes straight through, beside `consumedByExpense` (`:106-108`).
- **`src/server/transactions/transactions.service.test.ts`**
  - Add `datedAmounts: unstaged` to `serviceWith`'s defaults (`:24-37`).
  - Add one case: it returns the repository's rows unchanged.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes

## Phase 2: Cashflow

One change, three commits.

### Changes

**Commit 1: characterize**

- **New `src/server/api/routers/cashflow.test.ts`.** Mirror step 4's harness (`f2d8107`).
  - **Harness.**
    - `createCallerFactory(createTRPCRouter({ cashflow: cashflowRouter }))({ db, session, services: {}, headers: new Headers() } as never)`.
    - Session defaults to `{ user: { id: "member-1" } }`. `null` means signed out.
    - `db` comes from `recordingDb(respond)`. `respond` matches on `query.sql`:
      - `group by` → consumption
      - `from "transaction"` → actuals
      - `from "expense"`
      - `from "income"`
      - `from "app_setting"`
      - `from "balance_snapshot"`
    - Date-only fake timers pin `now`, as in `income.repository.test.ts:47-50`.
  - **Fixtures.**
    - Expenses and incomes use `satisfies Expense` / `satisfies Income`, and their rows use `rowOf` with `Object.keys(getTableColumns(…))`.
    - Stage the expense rows already in the new order (category, sort order, name), so Commit A's result stays identical.
    - The fixture must exercise every input:
      - a historic Spend Transaction and a historic Inflow Transaction
      - a recurring Expense with a due day
      - a one-time Expense with some consumption
      - one Income
      - anchor `"2026-08-26"`
      - a balance snapshot
  - **Expected result.** Build `buildCashflow({ now: NOW, periodKind, fortnightAnchor: fromDateInput("2026-08-26"), transactions, expenses, incomes, consumedByExpenseId, anchor })` from the same fixtures. The router's result must `toEqual` it. This pins the wiring. `cashflow.test.ts` already covers the compute.
  - **Spot checks**, so a fixture that exercises nothing fails loudly:
    - `hasBalanceAnchor` is `true`
    - there are 25 buckets
    - one historic bucket's `spend` and `inflow` equal the staged Transactions
    - the current bucket's `items` include the Expense and Income labels
  - **Cases:**
    - **`get({ periodKind: "fortnight" })`.** The full fixture. Pins all six queries in one `toMatchInlineSnapshot`, as `queries.map(({ sql, params }) => ({ sql, params }))` sorted by `sql` (`recording-db.fake.ts:13-14`: `Promise.all` promises no order). Plus the expected result and the spot checks.
    - **`get({})`** defaults to `"fortnight"`. The result equals the fortnight expectation.
    - **`get({ periodKind: "month" })`.** The result equals `buildCashflow` with `"month"`.
    - **No anchor row**, and an invalid stored anchor (`"2026-02-30"`) → `fortnightAnchor: null`. The fortnight result falls back to the month grid. Results only, no SQL snapshot.
    - **No balance snapshot** → `anchor: null` and `hasBalanceAnchor: false`.
    - **A driver error** on the `expense` select → `INTERNAL_SERVER_ERROR`.
    - **`periodKind: "week"`** → `BAD_REQUEST` with zero queries.
    - **Signed out** → `UNAUTHORIZED` with zero queries.

**Commit A: serve through the tiers**

- **New `src/server/cashflow/cashflow.service.ts`:** `CashflowService`.
  - Deps:

    ```ts
    interface CashflowServiceDeps {
    	transactions: Pick<TransactionsService, "datedAmounts" | "consumedByExpense">;
    	expenses: Pick<ExpensesService, "list">;
    	income: Pick<IncomeService, "list">;
    	settings: Pick<SettingsService, "fortnightAnchor">;
    	balances: Pick<BalancesService, "latest">;
    }
    ```

    Each service class is a type-only import, as in `transactions.service.ts:15`.
  - **`get(periodKind: PeriodKind): Promise<CashflowResult>`.** `PeriodKind` comes from `src/lib/period.ts:5`.
    - Makes the six service calls in one `Promise.all`.
    - Calls `buildCashflow` with the same shape as `cashflow.ts:65-76`:
      - `consumedByExpenseId` is `new Map(consumption.map(({ expenseId, consumed }) => [expenseId, consumed]))`, with no cast.
      - `fortnightAnchor` is `anchor ? fromDateInput(anchor) : null`.
      - `anchor` is the snapshot's `{ amount, asOf }`, or null.
      - `now: new Date()`.
    - Move the comment from `cashflow.ts:17-18` here. Drop the copy comment at `:35-36`.
  - Class comment: a top-level read service with no tables. It calls only services below it (design `:309-323`), so it has no repository (design `:300-301`).
- **New `src/server/cashflow/cashflow.service.test.ts`.** `serviceWith(staged)` builds all five ports with `unstaged` defaults, as in `settings.service.test.ts:12-19`. It uses date-only fake timers. Each expectation is `buildCashflow(expectedInput)`, as in Commit 1.
  - **Wiring.** The five ports' results reach `buildCashflow`:
    - consumption rows become a map keyed by `expenseId`
    - the anchor string is parsed
    - the snapshot narrows to `{ amount, asOf }`
    - `now` is the pinned time
  - `periodKind` is passed through: `"month"` gives the month grid.
  - **Each port is called once**, with no arguments. Use `recorder`.
  - **No anchor** (`null`) → `fortnightAnchor: null`.
  - **No snapshot** (`null`) → `anchor: null` and `hasBalanceAnchor: false`.
  - **A port that rejects** (`throwing`) → `get` rejects with the same reference.
- **New `src/server/cashflow/cashflow.trpc.controller.ts`:** `export const cashflowRouter = createTRPCRouter({ get: protectedProcedure.input(cashflowQueryDto).query(({ ctx, input }) => ctx.services.cashflow.get(input.periodKind)) })`. No Drizzle, no try/catch, no `TRPCError`.
- **New `src/server/cashflow/cashflow.trpc.controller.test.ts`.** `callerWith(cashflow, session?)` as in `settings.trpc.controller.test.ts:8-12`, with `recorder` fakes.
  - `get({ periodKind: "month" })` calls `get` with `["month"]` and returns the service's result.
  - `get({})` calls it with `["fortnight"]`, the DTO default.
  - `periodKind: "week"` → `BAD_REQUEST`, and the fake is never called.
  - Signed out → `UNAUTHORIZED`, and the fake is never called.
- **`src/server/api/services.ts`**
  - Hoist `balances`, `income`, `settings` and `transactions` out of the `services` object (`:33-46`) into local consts beside `expenses` (`:17-19`).
  - Put each one back under its own key.
  - Add `cashflow: new CashflowService({ transactions, expenses, income, settings, balances })`.
- `src/server/api/root.ts:1` — import `cashflowRouter` from `~/server/cashflow/cashflow.trpc.controller`. The key (`:16`) does not change.
- **The proof.** Point `routers/cashflow.test.ts` at the new router through `createTestCaller`, as `5d68c58` did for the allowlist.
  - `services: { cashflow: new CashflowService({ … }) }`, built from the real `Drizzle*Repository` + service pairs for all five domains on one `recordingDb` (`db as never`), with no `ctx.db`. `TransactionsService` also takes an `ExpensesService` for `namesByIds`.
  - **The one intended snapshot diff.** The `expense` select gains `order by` category, sort order, name. The `income` select gains `order by` person, sort order, source.
  - The other four SQL statements, the query count, and every result, spot check and code assertion stay byte-identical.

**Commit B: remove the router, update the docs**

- **Delete `src/server/api/routers/cashflow.ts` and `cashflow.test.ts`.** The cases now live elsewhere:
  - **SQL** is pinned by each owner's repository test:
    - `expenses.repository.test.ts:68`
    - `income.repository.test.ts:53`
    - `settings.repository.test.ts:18`
    - `balances.repository.test.ts:42`
    - `transactions.repository.test.ts:512`, plus Phase 1's `datedAmounts`
  - **Wiring** goes to `cashflow.service.test.ts`.
  - **Auth and input** go to `cashflow.trpc.controller.test.ts`.
- **`src/server/architecture.test.ts` to-do list.** Delete the 6 `routers/cashflow.ts` entries (`:41-46`). The list goes from 16 to 10.
- **`.claude/rules/server-architecture.md`**
  - `:149`: the list becomes `receipt`. Add that `cashflow` comes from `src/server/cashflow/`.
  - After the tier map (`:33`), add one line: a domain with no tables, such as `cashflow/`, has no repository. Its service depends only on other services' ports.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md`**
  - "Done" (`:80`) adds: `src/server/cashflow/` — `cashflow.trpc.controller.ts` → `CashflowService`, with no repository. It calls the transactions, expenses, income, settings and balances services and hands their results to `buildCashflow`. Consumption comes from `TransactionsService.consumedByExpense`, not a copied query.
  - "Next" (`:81`) becomes categories (step 6). `receipts.ts` stays last (step 7), when the bound `commitWithOutbox` shim retires.

### Success

- [x] `make check` passes
- [x] `make test` passes. Commit 1 is green against the unchanged `cashflow.ts`. In Commit A, only the `expense` and `income` SQL snapshots change.
- [x] `make build` passes
- [x] `git grep -n -E "drizzle-orm|\.schema|TRPCError|ctx\.db" src/server/cashflow/` returns nothing
- [x] `src/server/api/routers/` holds only `receipts` files, and the to-do list has 10 entries
- [x] Every path named in the edited rules-file lines exists (`git ls-files` check)
- [x] At https://personal-finance.localhost, the dashboard cash flow chart behaves as before:
  - Fortnight and Month both render 25 buckets, with the today marker on the current bucket.
  - The tooltip on a forward bucket lists Expenses and Income, in the list reads' order: Expenses by category A–Z, sort order, name; then Income by person, sort order, source. (Validation: 521 items checked against `expense.list` + `income.list`, no item out of order.)
  - The balance line shows when a snapshot exists.
  - Saving a balance snapshot, or changing the pay cycle anchor in Settings, refreshes the chart. (Pay cycle path checked in the browser. Balance save not run, to keep real data intact; its client invalidation is unchanged.)

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md`. It carries `## Related ADRs`. Relevant sections:
  - § Migration step 5 (`:816-817`)
  - § Router map (`:291,300-301`)
  - § Domain hierarchy, mirror the kernel (`:270-273`)
  - § Dependency graph (`:305-323`)
  - § Tier files (`:221-232`)
  - § Module files (`:395-398`)
  - § Replacing a join (`:551`)
  - § Consumption (`:553-559`)
- ADRs:
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phase 2 (the cashflow controller)
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — implemented by Phases 1 and 2. Cashflow reads through the owning services. "Copies go" (`:64`) and the consumption ownership (`:51`) land. 6 rule-3 entries clear.
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted) — its Implementation status is updated in Phase 2
  - adr023, adr024 and adr025 (Proposed) are not this step. Steps 6 and 7 implement them.
- Prior plans:
  - `thoughts/plans/2026-10-07-trpc-3-tier-step-4-members-allowlist.md` (new code first, then characterize → serve → remove)
  - `thoughts/plans/2026-10-06-trpc-3-tier-step-3-income-balances-settings.md` (the services cashflow now calls)
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md`, **Inflow** and **Spend** (`:10-15`), **Transaction** (`:25-26`), **Expense** (`:28-30`)
- Related:
  - `src/server/api/routers/cashflow.ts:16-78` (deleted in Phase 2)
  - `src/domain/cashflow/cashflow.ts:7-16,51,152-198`
  - `src/server/transactions/transactions.repository.ts:38-56,246-262`, `transactions.service.ts:33-45,106-108`
  - `src/server/api/services.ts:17-47`, `src/server/api/root.ts:1,16`
  - `src/server/architecture.test.ts:38-55`
