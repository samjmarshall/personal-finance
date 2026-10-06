---
date: 2026-10-06
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022]
status: Ready to implement
---
# tRPC 3-tier migration, step 3: income, balances, settings — Implementation Plan

## Context

Steps 1 and 2 shipped. `income.ts`, `balance.ts` and `setting.ts` are still plain routers that query Drizzle through `ctx.db`. This is migration step 3 of the design: "Income, then balances, then settings. One change each." Each router moves into its domain folder as a tRPC controller over a service and a repository (adr021), and stops importing its table from an entry point (adr022 rule 3). The member sees no change: every tRPC path, code and message stays the same.

## Current State

- **The income router** (`src/server/api/routers/income.ts`, 41 lines):
  - `list` (`:9-14`) orders by `person`, `sortOrder`, `source` asc.
  - `create` (`:16-21`) inserts `incomeCreateDto` and returns through `assertRow(row, "create income")`.
  - `update` (`:23-33`) sets everything but `id` and returns through `assertRow(row, "update income")`. So a missing id is `INTERNAL_SERVER_ERROR` "Failed to update income.", not `NOT_FOUND`.
  - `delete` (`:35-40`) takes an inline `z.object({ id: z.number() })` (`:36`) and returns `{ success: true }`, even when no row had the id.
- **The balance router** (`src/server/api/routers/balance.ts`, 30 lines):
  - `latest` (`:9-18`) selects one row ordered by `asOf` desc, then `id` desc, and returns `row ?? null`.
  - `set` (`:21-29`) appends a new snapshot (never an edit, comment `:20`) and returns through `assertRow(row, "set balance")`.
- **The setting router** (`src/server/api/routers/setting.ts`, 42 lines):
  - `fortnightAnchor` (`:16-24`) selects `value` where `key = FORTNIGHT_ANCHOR_KEY`. It returns the string only if `fromDateInput` parses it (`:22`), else `null`. It returns a string, not a `Date`, on purpose (`:10-15`).
  - `setFortnightAnchor` (`:29-41`) upserts with `onConflictDoUpdate` on `key` and returns `assertRow(row, "set fortnight anchor").value`.
- **All three are simple.** Every procedure is `protectedProcedure`. None reads `ctx.session`, throws `TRPCError`, uses try/catch, opens a database transaction, writes the outbox or reads another domain's table. The only error source is `assertRow` (`src/server/errors/assert-row.ts:3-6`), reached through the `src/server/api/lib/assert-row.ts` re-export.
- **Tests.** Only `src/server/api/routers/setting.test.ts` (92 lines) exists:
  - It still mocks `~/server/db` and `~/server/auth` (`:5-6`) and uses a hand-rolled upsert fake (`:26-48`).
  - It covers `setFortnightAnchor` only (`:52-91`).
  - `income.ts` and `balance.ts` have no test.
- **Schemas already live in the domain folders:**
  - `src/server/income/income.schema.ts:9-30`. `createdAt` uses `$defaultFn` (`:25-28`) and `updatedAt` uses `$onUpdate` (`:29`).
  - `src/server/balances/balances.schema.ts:6-14`. `createdAt` uses `$defaultFn` (`:10-13`).
  - `src/server/settings/settings.schema.ts:5-8` is a key/value table. `FORTNIGHT_ANCHOR_KEY` lives in `src/server/settings/settings.constants.ts:4`.
  - These folders hold no tier files yet.
- **Domain kernel.**
  - `src/domain/income/income.dto.ts:48-57` exports both DTOs but no inferred input types. The barrel is `src/domain/income/index.ts:1-4`.
  - `src/domain/balances/balance.dto.ts:6-9` is the same. The barrel is `src/domain/balances/index.ts:1-4`.
  - `src/domain/settings/setting.dto.ts:8-15` holds `fortnightAnchorSetDto`. The barrel is `src/domain/settings/index.ts:1`.
  - The precedent for inferred types is `src/domain/expenses/expense.dto.ts:52,61`.
- **Cashflow reads all three tables** (`src/server/api/routers/cashflow.ts:9-13,34,48-56`) and uses `FORTNIGHT_ANCHOR_KEY` (`:51`). That is step 5.
- **Wiring.**
  - `src/server/api/services.ts:13-19` builds `expenses` and `transactions`.
  - `src/server/api/root.ts:2,4,6` imports the three routers from `routers/`, under the keys `balance`, `income` and `setting` (`:19,23,25`).
  - Nothing else imports them (`git grep "routers/(income|balance|setting)"`).
- **The architecture to-do list** (`src/server/architecture.test.ts:38-64`) has 25 entries. This step owns 6 of them, all rule 3:
  - `routers/balance.ts` (`:44-45`)
  - `routers/income.ts` (`:52-53`)
  - `routers/setting.ts` (`:60-61`)
- **The docs carry the router list and step numbers.**
  - `.claude/rules/server-architecture.md:142-144` lists the unmigrated routers.
  - `:151-152` says "step 6 … deletes" `src/server/api/lib/` and "Step 7 rewrites this section". That is stale since the 2026-10-06 design revision: it is now step 7 (design `:842`) and step 8 (`:849-850`).
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80` (Done) and `:81` (Next) track progress.
- **Precedents to mirror:**
  - Tiers:
    - `src/server/expenses/expenses.repository.ts:19-61` (port, deps, `db: typeof realDb`)
    - `src/server/expenses/expenses.service.ts:50-79`, with the "missing id stays a 500" comment at `:69`
    - `src/server/expenses/expenses.trpc.controller.ts:5-27`
  - Tests:
    - `src/server/expenses/expenses.repository.test.ts:15-35`: the harness over `recordingDb` and `rowOf`. Fake timers are at `:68-72`.
    - `src/server/expenses/expenses.service.test.ts:10-29`: `serviceWith` with `unstaged` defaults.
    - `src/server/transactions/transactions.trpc.controller.test.ts:11-18`: `callerWith`.
  - Helpers:
    - `createTestCaller` (`src/server/api/test-caller.ts:20-33`)
    - `recorder`, `throwing`, `unstaged` (`src/test/fakes.ts:7-24`)
    - `recordingDb` (`src/server/db/recording-db.fake.ts:17-56`)
  - Commit shape: step 2's characterize → serve → remove (`204ad8f`, `5f301e6`, `b3c9541`).
- **Glossary** (`CONTEXT.md`): **Income** (`:58`). An Income's "person" is a name, not a login (`:45`).
- **Client callers.** None of these paths change:
  - `api.income.*`: `src/app/(dashboard)/income/` and `src/app/(dashboard)/page.tsx:24`
  - `api.balance.*`: `src/app/(dashboard)/_components/balance-snapshot-card.tsx` and `page.tsx:30`
  - `api.setting.*`: `src/app/(dashboard)/settings/` and `src/app/(dashboard)/expenses/unplanned/`

## Desired End State

- **Each path is served by a controller over its own service and repository:**

  | Path | Controller | Service | Repository |
  | --- | --- | --- | --- |
  | `income.*` | `src/server/income/income.trpc.controller.ts` | `IncomeService` | `IncomeRepository` / `DrizzleIncomeRepository` |
  | `balance.*` | `src/server/balances/balances.trpc.controller.ts` | `BalancesService` | `BalancesRepository` / `DrizzleBalancesRepository` |
  | `setting.*` | `src/server/settings/settings.trpc.controller.ts` | `SettingsService` | `SettingsRepository` / `DrizzleSettingsRepository` |
- **`services.ts` builds `income`, `balances` and `settings`.**
- **`src/server/api/routers/income.ts`, `balance.ts`, `setting.ts` and `setting.test.ts` are gone.** `routers/` holds only `allowed-sender`, `cashflow` and `receipts`.
- **The to-do list has 19 entries.**
- **Every tRPC path, code and message matches today's:**
  - `income.update` on a missing id is still `INTERNAL_SERVER_ERROR` "Failed to update income.".
  - `income.delete` on a missing id still returns `{ success: true }`.
  - `setting.fortnightAnchor` is still `null` when the row is missing or malformed.
- `make check`, `make test` and `make build` are green.

## Out of Scope

- **Cashflow (step 5).** It keeps reading the three tables and `FORTNIGHT_ANCHOR_KEY`, and its 6 to-do entries stay. Step 5 calls `income.list()`, `balances.latest()` and `settings.fortnightAnchor()`, which this step creates.
- **Moving `settings.constants.ts`.** Cashflow still imports it.
- **Turning `income.update`'s missing-row 500 into `NOT_FOUND`, or making `income.delete` report a missing row.** Either would change what the member sees.
- **Steps 4 and 6–8:** members and the allowlist, categories, receipts, `*.module.ts` files, deleting `src/server/api/lib/`, and removing `ctx.db`.
- **`memberId` arguments.** No method reads one (design § Only where used).
- **Any tRPC path, response shape or client change.**
- **Changing adr021 or adr022 `Status:`.** Both stay Proposed.

## Approach

Three changes, in the design's order. Each follows step 2's commit shape:

1. **Characterize.** Pin the old router's SQL, params, results, codes and messages through `recordingDb`.
2. **Serve (Commit A).** Add the three tiers, with each query lifted verbatim. Point the characterization test at the new controller through `createTestCaller` and a real service over `recordingDb`. If every snapshot stays byte-identical, the move is proven.
3. **Remove (Commit B).** Delete the old router and its test, clear its to-do entries and update the docs.

Repository tests use `recordingDb` rather than the hand-rolled fake that `.claude/rules/server-architecture.md:110-117` names as the default. Both migrated domains already do this, and it lets the characterization snapshots carry over unchanged. Most service methods are one-line pass-throughs. adr004 (`:71`) keeps them as the home for future scoping.

## Phase 1: Income

One change, three commits.

### Changes

**Commit 1: characterize**

- **New `src/server/api/routers/income.test.ts`, over the unchanged router.**
  - **Harness.**
    - `createCallerFactory(createTRPCRouter({ income: incomeRouter }))({ db, session: { user: { id: "member-1" } }, services: {}, headers: new Headers() } as never)`, with `db` from `recordingDb(respond)`.
    - No `vi.mock`.
    - `rowOf` keyed on `getTableColumns(income)` (copy `expenses.repository.test.ts:26-35`).
    - Fake timers pin `createdAt` and `updatedAt` (copy `:68-72`).
  - **What each case pins.** SQL text and params go in `toMatchInlineSnapshot`. Codes and messages use `toMatchObject`.
  - **`list`:** the select ordered by `person`, `sort_order`, `source` asc. Staged rows come back as `Income`s.
  - **`create`:** the insert SQL and params, and the returned row. Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to create income.".
  - **`update`:**
    - The update SQL and params. `id` is not in `set`. Omitted `amount` / `expectedDate` are absent from `set`, which pins `income.dto.ts:4-5` at the SQL level.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to update income.".
  - **`delete`:** the delete SQL. It returns `{ success: true }`, also when no row matched.
  - **Signed out:** `session: null` → `UNAUTHORIZED` with zero queries.

**Commit A: serve through the tiers**

- **`src/domain/income/income.dto.ts` exports inferred input types:**
  - `IncomeCreateInput` (after `:48-50`)
  - `IncomeUpdateInput` (after `:55-57`)

  Use `z.infer`, as in `expense.dto.ts:52,61`. `src/domain/income/index.ts` re-exports them.
- **New `src/server/income/income.repository.ts`:** `interface IncomeRepository` + `class DrizzleIncomeRepository`.
  - `interface DrizzleIncomeRepositoryDeps { db: typeof realDb }`, as in `expenses.repository.ts:52-61`.
  - Touches only `income`. No try/catch, no logging.
  - Each method lifts today's query verbatim:

    | Method | Lifted from |
    | --- | --- |
    | `list()` | `income.ts:10-13` |
    | `insert(values: IncomeCreateInput)` | `income.ts:19`. Returns the row or `undefined`. |
    | `update(id, values: Omit<IncomeUpdateInput, "id">)` | `income.ts:27-31`. JSDoc: `` `undefined` when no row has the id. `` |
    | `delete(id)` | `income.ts:38` |
- **New `src/server/income/income.repository.test.ts`.**
  - Harness as in `expenses.repository.test.ts:15-21`, with the same fake timers.
  - Each method gets its procedure's Commit 1 snapshot, copied unchanged.
  - A driver error from `insert` bubbles unchanged.
- **New `src/server/income/income.service.ts`:** `IncomeService`, with `interface IncomeServiceDeps { repository: IncomeRepository }`.
  - `list()` passes through.
  - `create(input)` returns through `assertRow(row, "create income")`.
  - `update({ id, ...values })` returns through `assertRow(row, "update income")`. Copy the comment at `expenses.service.ts:69`: a missing id stays a 500.
  - `delete(id)` returns `void`.
  - It imports from `~/server/errors/assert-row`, not `~/server/api/lib/`.
- **New `src/server/income/income.service.test.ts`.** `serviceWith` uses `unstaged` defaults, as in `expenses.service.test.ts:10-29`.
  - `create` and `update` return the repository's row.
  - `update` hands the repository `id` and the values separately.
  - An empty `insert` or `update` → a plain `Error` "Failed to create income." / "Failed to update income.", not a `NotFoundError`.
  - A driver error from `insert` propagates as the same reference.
  - `list` and `delete` pass through.
- **New `src/server/income/income.trpc.controller.ts`:** `export const incomeRouter = createTRPCRouter({ … })`.
  - `list`, `create`, `update` and `delete` each make one `ctx.services.income.<method>(…)` call.
  - Same DTOs, and the inline `delete` input from `income.ts:36`.
  - `delete` awaits the call and returns `{ success: true }`.
  - No Drizzle, no try/catch. Shape as in `expenses.trpc.controller.ts:5-27`.
- **New `src/server/income/income.trpc.controller.test.ts`.** `createTestCaller` with `Partial<IncomeService>` fakes and `recorder`.
  - Each procedure calls its method with the parsed input.
  - `delete` returns `{ success: true }`.
  - A one-time `create` with no amount → `BAD_REQUEST`, and the fake is never called.
  - A fake `update` that throws `new Error("Failed to update income.")` → `INTERNAL_SERVER_ERROR` with that message.
  - Signed out → `UNAUTHORIZED`, and the fake is never called.
- `src/server/api/services.ts:13-19` — add `income: new IncomeService({ repository: new DrizzleIncomeRepository({ db }) })`.
- `src/server/api/root.ts:4` — import `incomeRouter` from `~/server/income/income.trpc.controller`. The key (`:23`) does not change.
- **The proof.** Point `routers/income.test.ts` at the new router through `createTestCaller`:
  - Use `services: { income: new IncomeService({ repository: new DrizzleIncomeRepository({ db: db as never }) }) }`, with `db` from `recordingDb`, and no `ctx.db`.
  - Every inline snapshot and assertion stays byte-identical and green.

**Commit B: remove the router, update the docs**

- **Delete `src/server/api/routers/income.ts` and `income.test.ts`.** The cases now live elsewhere:
  - SQL goes to `income.repository.test.ts`.
  - Messages go to `income.service.test.ts`.
  - Auth and input go to `income.trpc.controller.test.ts`.
- **`src/server/architecture.test.ts` to-do list.** Delete the 2 `routers/income.ts` entries (`:52-53`). The list goes from 25 to 23.
- **`.claude/rules/server-architecture.md`:**
  - `:142-144` — the list becomes `allowedSender, balance, cashflow, receipt, setting`. Add that `income` comes from `src/server/income/`.
  - `:151-152` — "step 6 of the migration deletes it" becomes step 7, and "Step 7 rewrites this section" becomes Step 8 (design `:835-850`).
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md`:**
  - "Done" (`:80`) adds `src/server/income/`: `income.trpc.controller.ts` → `IncomeService` → `IncomeRepository` / `DrizzleIncomeRepository`.
  - "Next" (`:81`) starts with "balances, then settings (step 3)".
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — implements this decision for income.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — clears `routers/income.ts`'s rule-3 entries.

### Success

- [x] `make check` passes
- [x] `make test` passes. Commit 1 is green against the unchanged `income.ts`, and Commit A is green with no snapshot change.
- [x] `make build` passes
- [x] `git grep -n -E "drizzle-orm|TRPCError|ctx\.db" src/server/income/income.service.ts src/server/income/income.trpc.controller.ts` returns nothing
- [x] `src/server/api/routers/income.ts` no longer exists, and the to-do list has 23 entries
- [ ] At https://personal-finance.localhost, the Income page behaves as before:
  - the list order
  - creating a recurring and a one-time Income. A one-time Income with no amount shows the form error.
  - editing and deleting
  - the dashboard's income figures are unchanged

## Phase 2: Balances

One change, three commits.

### Changes

**Commit 1: characterize**

- **New `src/server/api/routers/balance.test.ts`.** The same harness over `balanceRouter`, with `rowOf` keyed on `getTableColumns(balanceSnapshots)` and fake timers pinning `createdAt`.
  - **`latest`:**
    - The select ordered by `as_of` desc then `id` desc, with `limit`.
    - A staged row comes back as a `BalanceSnapshot`.
    - No rows → `null`.
  - **`set`:**
    - The insert SQL and params (`amount`, `asOf`, the pinned `createdAt`), and the returned row.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to set balance.".
  - **Signed out:** `UNAUTHORIZED` with zero queries.

**Commit A: serve through the tiers**

- `src/domain/balances/balance.dto.ts` — export `BalanceSetInput = z.infer<typeof balanceSetDto>` (after `:6-9`). `src/domain/balances/index.ts` re-exports it.
- **New `src/server/balances/balances.repository.ts`:** `interface BalancesRepository` + `class DrizzleBalancesRepository`, with the same deps shape.

  | Method | Lifted from |
  | --- | --- |
  | `findLatest()` | `balance.ts:11-15`. JSDoc: `` `undefined` when there are no snapshots. `` |
  | `insert(values: BalanceSetInput)` | `balance.ts:24-27` |
- **New `src/server/balances/balances.repository.test.ts`.** Each method gets its Commit 1 snapshot, copied unchanged.
- **New `src/server/balances/balances.service.ts`:** `BalancesService`, with `interface BalancesServiceDeps { repository: BalancesRepository }`.
  - `latest()` returns `(await this.repository.findLatest()) ?? null`. Keep the comment from `balance.ts:8`: the newest snapshot anchors the projection, ties go to the higher id.
  - `set(input)` returns through `assertRow(row, "set balance")`. Keep the append-only comment from `:20`.
- **New `src/server/balances/balances.service.test.ts`:**
  - `latest` returns the row, or `null` when the repository gives `undefined`.
  - `set` returns the row. An empty `insert` → a plain `Error` "Failed to set balance.".
- **New `src/server/balances/balances.trpc.controller.ts`:** `export const balanceRouter`.
  - `latest` → `ctx.services.balances.latest()`
  - `set` → `ctx.services.balances.set(input)`, with `balanceSetDto`
- **New `src/server/balances/balances.trpc.controller.test.ts`:**
  - Each procedure calls its method with the parsed input.
  - `set` with no `amount` → `BAD_REQUEST`, and the fake is never called.
  - Signed out → `UNAUTHORIZED`.
- `src/server/api/services.ts` — add `balances: new BalancesService({ repository: new DrizzleBalancesRepository({ db }) })`.
- `src/server/api/root.ts:2` — import `balanceRouter` from `~/server/balances/balances.trpc.controller`. The key (`:19`) does not change.
- **The proof.** Point `routers/balance.test.ts` at the new router through `createTestCaller` and a real `BalancesService` over `recordingDb`. Every snapshot stays byte-identical.

**Commit B: remove the router, update the docs**

- Delete `src/server/api/routers/balance.ts` and `balance.test.ts`.
- **`src/server/architecture.test.ts` to-do list.** Delete the 2 `routers/balance.ts` entries (`:44-45`). The list goes from 23 to 21.
- `.claude/rules/server-architecture.md:142-144` — the list becomes `allowedSender, cashflow, receipt, setting`. Add that `balance` comes from `src/server/balances/`.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md`:**
  - "Done" (`:80`) adds `src/server/balances/`: `balances.trpc.controller.ts` → `BalancesService` → `BalancesRepository` / `DrizzleBalancesRepository`.
  - "Next" (`:81`) starts with "settings (step 3)".
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — implements this decision for balances.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — clears `routers/balance.ts`'s rule-3 entries.

### Success

- [x] `make check` passes
- [x] `make test` passes. Commit 1 is green against the unchanged `balance.ts`, and Commit A is green with no snapshot change.
- [x] `make build` passes
- [x] `git grep -n -E "drizzle-orm|TRPCError|ctx\.db" src/server/balances/balances.service.ts src/server/balances/balances.trpc.controller.ts` returns nothing
- [x] `src/server/api/routers/balance.ts` no longer exists, and the to-do list has 21 entries
- [ ] At https://personal-finance.localhost, the dashboard balance card behaves as before:
  - it shows the latest snapshot
  - recording a new balance updates the card
  - recording a new balance re-anchors the cash flow chart (`balance-snapshot-card.tsx:26` invalidates `cashflow.get`)

## Phase 3: Settings

One change, three commits.

### Changes

**Commit 1: characterize**

- **Rewrite `src/server/api/routers/setting.test.ts` onto the `recordingDb` harness.**
  - Drop the `vi.mock` calls (`:5-6`), the dynamic imports (`:8-13`) and the hand-rolled `upsertDb` (`:26-48`).
  - **Keep its three cases:**
    - `setFortnightAnchor` pins the upsert SQL and params (`insert … on conflict ("key") do update set "value"`), and returns the string `"2026-08-26"`.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to set fortnight anchor.".
    - `"2026-02-30"` is rejected with zero queries.
  - **Add:**
    - `fortnightAnchor` pins the select SQL and params, with the key `fortnightAnchor`.
    - A stored `"2026-08-26"` → `"2026-08-26"`.
    - No row → `null`.
    - A stored `"2026-02-30"` → `null`.
    - Signed out → `UNAUTHORIZED` with zero queries, for both procedures.

**Commit A: serve through the tiers**

- **New `src/server/settings/settings.repository.ts`:** `interface SettingsRepository` + `class DrizzleSettingsRepository`, with the same deps shape.
  - It is generic by key, because the table is key/value (`settings.schema.ts:3-8`). Which key to use is the service's business.
  - `export interface SettingRow { key: string; value: string }`, like `NameRow` (`expenses.repository.ts:14-17`).

  | Method | Lifted from |
  | --- | --- |
  | `findValue(key)` | `setting.ts:18-21`. Returns `row?.value`. JSDoc: `` `undefined` when no row has the key. `` |
  | `upsert(key, value)` | `setting.ts:32-39`. Returns `SettingRow \| undefined`. |
- **New `src/server/settings/settings.repository.test.ts`.**
  - Each method gets its Commit 1 snapshot, copied unchanged.
  - `findValue` returns `undefined` when there are no rows.
- **New `src/server/settings/settings.service.ts`:** `SettingsService`, with `interface SettingsServiceDeps { repository: SettingsRepository }`.
  - **`fortnightAnchor(): Promise<string | null>`.**
    - It reads `findValue(FORTNIGHT_ANCHOR_KEY)` and returns the value only when `fromDateInput` parses it, else `null`.
    - Move the string-not-`Date` comment from `setting.ts:10-15` here.
  - **`setFortnightAnchor(anchor: string): Promise<string>`.**
    - It returns `assertRow(await this.repository.upsert(FORTNIGHT_ANCHOR_KEY, anchor), "set fortnight anchor").value`.
    - Move the upsert comment from `:26-28`.
  - `assertRow` takes the row, not the string, because it checks `!row` (`assert-row.ts:4`).
- **New `src/server/settings/settings.service.test.ts`:**
  - `fortnightAnchor` asks the repository for `FORTNIGHT_ANCHOR_KEY`. A valid date → the string. `undefined` → `null`. `"2026-02-30"` → `null`.
  - `setFortnightAnchor` upserts under `FORTNIGHT_ANCHOR_KEY` and returns the stored value. An empty upsert → a plain `Error` "Failed to set fortnight anchor.".
- **New `src/server/settings/settings.trpc.controller.ts`:** `export const settingRouter`.
  - `fortnightAnchor` → `ctx.services.settings.fortnightAnchor()`
  - `setFortnightAnchor` → `ctx.services.settings.setFortnightAnchor(input.anchor)`, with `fortnightAnchorSetDto`
- **New `src/server/settings/settings.trpc.controller.test.ts`:**
  - Each procedure calls its method. `setFortnightAnchor` passes the parsed anchor.
  - `"2026-02-30"` → `BAD_REQUEST`, and the fake is never called.
  - Signed out → `UNAUTHORIZED`.
- `src/server/api/services.ts` — add `settings: new SettingsService({ repository: new DrizzleSettingsRepository({ db }) })`.
- `src/server/api/root.ts:6` — import `settingRouter` from `~/server/settings/settings.trpc.controller`. The key (`:25`) does not change.
- **The proof.** Point `routers/setting.test.ts` at the new router through `createTestCaller` and a real `SettingsService` over `recordingDb`. Every snapshot stays byte-identical.

**Commit B: remove the router, update the docs**

- Delete `src/server/api/routers/setting.ts` and `setting.test.ts`.
- **`src/server/architecture.test.ts` to-do list.** Delete the 2 `routers/setting.ts` entries (`:60-61` today). The list goes from 21 to 19.
- `.claude/rules/server-architecture.md:142-144` — the list becomes `allowedSender, cashflow, receipt`. Add that `setting` comes from `src/server/settings/`.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md`:**
  - "Done" (`:80`) adds `src/server/settings/`: `settings.trpc.controller.ts` → `SettingsService` → `SettingsRepository` / `DrizzleSettingsRepository`.
  - "Next" (`:81`) becomes members, then the allowlist (step 4), then cashflow (step 5) and categories (step 6). `receipts.ts` stays last (step 7), when the bound `commitWithOutbox` shim retires.
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — implements this decision for settings.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — clears `routers/setting.ts`'s rule-3 entries.

### Success

- [x] `make check` passes
- [x] `make test` passes. Commit 1 is green against the unchanged `setting.ts`, and Commit A is green with no snapshot change.
- [x] `make build` passes
- [x] `git grep -n -E "drizzle-orm|TRPCError|ctx\.db" src/server/settings/settings.service.ts src/server/settings/settings.trpc.controller.ts` returns nothing
- [x] `src/server/api/routers/` holds only `allowed-sender`, `cashflow` and `receipts` files, and the to-do list has 19 entries
- [x] Every path named in the edited rules-file sections exists (`git ls-files` check)
- [ ] At https://personal-finance.localhost, these behave as before:
  - the Settings page shows the saved pay-cycle anchor
  - saving a new anchor persists after a reload
  - the Unplanned page's fortnight picker uses the anchor
  - the cash flow fortnight view still windows on it

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md`. It carries `## Related ADRs`. Relevant sections:
  - § Migration step 3 (`:814`)
  - § Router map (`:281-303`)
  - § Tier files (`:221-232`)
  - § Testing (`:750-783`)
- ADRs:
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phases 1–3, for income, balances and settings
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — Phases 1–3 clear the three routers' rule-3 to-do entries
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted) — its Implementation status is updated in each phase
  - adr023, adr024 and adr025 (Proposed) are not this step. Steps 6 and 7 implement them.
- Prior plans:
  - `thoughts/plans/2026-09-29-trpc-3-tier-step-1-foundation-transactions.md`
  - `thoughts/plans/2026-10-02-trpc-3-tier-step-2-expenses-categories.md` (the characterize → serve → remove shape)
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md`, **Income** (`:58`)
- Related:
  - `src/server/api/routers/income.ts:8-41`, `balance.ts:7-30`, `setting.ts:9-42` (deleted in Phases 1–3)
  - `src/server/api/routers/cashflow.ts:9-13,48-56` (step 5)
  - `src/server/api/services.ts:13-19`, `src/server/api/root.ts:2-6`
  - `src/server/architecture.test.ts:38-64`
