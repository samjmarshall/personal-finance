---
date: 2026-09-29
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022]
status: Done
---
# tRPC 3-tier migration, step 1: foundation + transactions — Implementation Plan

## Context

adr004 makes controller / service / repository the shape of every server entry point, but the nine tRPC routers still query Drizzle through `ctx.db` and throw `TRPCError` inline. The 2026-09-29 design settles how routers migrate (adr021) and forbids cross-domain table access (adr022). This is migration step 1: ship the shared foundation (domain errors, the error-mapping middleware, `ctx.services`, `context.ts`, the test caller, the architecture test) and migrate the reference domain, transactions, including Consumed. The member sees no change: every tRPC path, code and message stays the same.

## Current State

- **Context lives in `trpc.ts`.** `createTRPCContext` (`src/server/api/trpc.ts:39-48`) returns `{ db, session, ...opts }`, so `trpc.ts` imports `auth` and `db` at runtime (`:15-16`). Every router test stubs both for that reason (`src/server/api/routers/setting.test.ts:4-7`, `src/server/api/trpc.test.ts:21-24`). Consumers: `src/app/api/trpc/[trpc]/route.ts:7,39-43` and `src/trpc/server.ts:8,24`. The route test mocks `~/server/api/trpc` (`src/app/api/trpc/[trpc]/route.test.ts:7-10`).
- **The middleware chain** is dev latency → observability → auth (`trpc.ts:170-172`, `:182-196`). Observability treats `UNAUTHORIZED`, `FORBIDDEN` and `NOT_FOUND` as expected (`:107-111`). Other codes fail the span, and 5xx codes also go to `reportError` (`:134-146`). There is no error mapping.
- **The transactions router** (`src/server/api/routers/transaction.ts`, 288 lines) runs Drizzle inline:
  - `list` (`:55-126`) left-joins `expenses` and `expenseCategories` for display names (`:98-114`).
  - `summary` runs five aggregates (`:128-189`).
  - `create`, `update` and `linkExpense` (`:191-280`) catch FK violations through a local `rethrowFkConflict` (`:47-52`), with messages at `:38-43`, and throw `NOT_FOUND "Transaction not found."` inline (`:224-228`, `:274-278`).
  - `unplanned` (`:235-258`) and `delete` (`:282-287`) are plain queries.
  - **No test covers this router.**
- **Consumed** is computed in `expense.consumption` (`src/server/api/routers/expense.ts:28-47`), which reads `transactions` directly (`:11`). `src/server/api/routers/cashflow.ts:35-47` has a copy (step 5). The client reads it at `src/app/(dashboard)/expenses/_components/expenses-view.tsx:50,114`.
- **The shared helpers live in `src/server/api/lib/`.**
  - `assertRow` throws a `TRPCError` (`assert-row.ts:6-14`). Importers: `category.ts:10`, `balance.ts:3`, `transaction.ts:31`, `setting.ts:4`, `allowed-sender.ts:10`, `income.ts:4`, `expense.ts:8`, `receipts.ts:31`.
  - `parse-error.ts` (`isPgViolation` `:72-75`, with the `.cause` hop at `:49-51`) is imported by `category.ts:11`, `transaction.ts:32`, `allowed-sender.ts:11`, `receipts.ts:32`.
  - A second `rethrowFkConflict` copy is at `src/server/api/routers/receipts.ts:52-57`, used at `:310,332,354`.
- **Controllers today:**

  | File | Class | Deps interface |
  | --- | --- | --- |
  | `src/server/receipts/receipts.controller.ts` | `ReceiptsController` (`:19`) | `ReceiptsControllerDeps` (`:10`) |
  | `src/server/outbox/outbox.controller.ts` | `OutboxController` (`:15`) | `OutboxControllerDeps` (`:5`) |
  | `src/server/email/email.controller.ts` | `EmailController` (`:19`) | `EmailControllerDeps` (`:7`) |

  Importers: `src/server/inngest/functions.ts:7,9,19,33`, `src/server/inngest/registry-golden.test.ts:2,3,37,38`, `src/app/api/receipts/inbound/route.ts:6,24,26,29`, `src/app/api/receipts/inbound/route.test.ts:6,44-45`.
- **Tier precedents to mirror:**
  - Service shape: `src/server/outbox/outbox.service.ts:37-56`.
  - Repository with `db: typeof realDb`: `src/server/outbox/outbox.repository.ts:3,46-55`.
  - Repository test harness and `PgDialect` render: `src/server/outbox/outbox.repository.test.ts:7-86`.
  - Object-literal repository fake: `src/server/outbox/outbox.service.test.ts:62-82`.
  - Drizzle-wrapped pg error fixture: `src/server/api/routers/receipts.match.test.ts:28-32`.
  - Shared fake file naming: `src/server/observability/sdk/flush.fake.ts`.
  - Disk-scanning test: `src/server/db/schema-interface-contract.test.ts:71`.
  - `z.infer` type export: `src/domain/receipts/receipt-extraction.dto.ts:27`.
- **Architecture violations found today (36):**
  - **Rule 1 (2).** `src/server/email/email.repository.ts:7` imports `~/server/receipts/receipts.schema`. `src/server/receipts/receipts.repository.ts:5` imports `~/server/expenses/categories.schema`.
  - **Rule 3, routers (32).** Every router imports `drizzle-orm` and at least one `*.schema.ts`. `transaction.ts:18` also imports `drizzle-orm/pg-core`.
  - **Rule 3, routes (2).** `src/app/api/receipts/[id]/image/route.ts:2,7` imports `drizzle-orm` and `receipts.schema`.
  - **Rules 2 and 4: zero.**
  - Imports use `~/` (`tsconfig.json:29-31`) or `./sibling`, and there are no `../` imports under `src/server` or `src/app`. There is one multi-line dynamic `import(` at `src/server/inngest/middleware.ts:145-147`.
- **The rules file has drifted.** `.claude/rules/server-architecture.md:111-119` says cross-domain read joins are fine and "writes are direct db calls too", which contradicts adr004 and adr022.
- **The outbox barrel re-exports its table.** `src/server/outbox/index.ts:19` does `export { outbox } from "./outbox.schema"`, and nothing imports it. The barrel's only importer is `src/server/api/routers/receipts.ts:39` (`commitWithOutbox`).
- **Tooling:** Node 24 (`.nvmrc`), so `node:fs` `globSync` is available. tRPC is 11.18.0: `TRPCError` takes its message from `cause.message` when none is given, so a plain `Error("Failed to x.")` still reaches the member with the same message. drizzle-orm is 0.45.2 and ships `drizzle-orm/pg-proxy`, which wraps callback errors in `DrizzleQueryError` like production (`node_modules/drizzle-orm/pg-core/session.js:36-42`).

## Desired End State

- **The three controllers are renamed.** They are `receipts.inngest.controller.ts` / `ReceiptsInngestController`, `outbox.inngest.controller.ts` / `OutboxInngestController` and `email.http.controller.ts` / `EmailHttpController`. No Inngest id changes.
- **`src/server/errors/` exists.** It holds `NotFoundError`, `ConflictError`, `parse-error.ts`, `assert-row.ts` (now throws a plain `Error`) and `rethrowFkConflict` (now throws `ConflictError`). None of them import tRPC. `src/server/api/lib/` only re-exports them.
- **An error-mapping middleware sits between observability and auth on both procedures.** `NotFoundError` becomes `NOT_FOUND` and `ConflictError` becomes `CONFLICT`, each keeping its message and cause. Anything else is unchanged.
- **`createTRPCContext` lives in `src/server/api/context.ts`** and returns `{ db, session, services, ...opts }`. `trpc.ts` loads no `db` or `auth` at runtime.
- **`src/server/api/services.ts` builds `services.transactions` once.**
- **`createTestCaller` exists.** `src/server/api/test-caller.ts` lets controller tests run with no `vi.mock`.
- **`src/server/architecture.test.ts` enforces the 4 adr022 rules** with a to-do list of 32 entries after this step.
- **`transaction.*` is served by `src/server/transactions/transactions.trpc.controller.ts`** → `TransactionsService` → `DrizzleTransactionsRepository`. `expense.consumption` calls `ctx.services.transactions.consumedByExpense()`. `src/server/api/routers/transaction.ts` is gone.
- **The rules file and adr004's Implementation status describe the new shape.**
- `make check`, `make test` and `make build` are green.

## Out of Scope

- Steps 2–7:
  - replacing the transaction list's expense/category join (step 2)
  - the rest of `expense.ts` and `category.ts` (step 2)
  - cashflow's copied consumption query (step 5)
  - `receipts.ts`'s inline `TRPCError`s and deleting `src/server/api/lib/` (step 6)
  - removing `ctx.db` (step 7)
- Removing the `db`/`auth` stubs from other routers' tests. They still work and get rewritten in their own steps.
- Any tRPC path, response shape or client change. No `errorFormatter` change.
- Per-domain error classes, result types, published views and GRANTs, household scoping.
- Changing adr021 or adr022 `Status:` (both stay Proposed).
- Renaming the summary's `topCategories` field to the glossary's **Group**. That would be a client change.

## Approach

1. Rename the controllers first, in their own commit.
2. Pin today's transaction and consumption behaviour with characterization tests. They capture the real rendered SQL through a `pg-proxy` recording db, plus codes and messages. They then guard every later phase.
3. Land the foundation in three small phases. None of them changes what the member sees, and existing router tests plus the characterization tests prove it.
   - errors + middleware
   - context + services + test caller
   - architecture test
4. Migrate transactions with its SQL lifted verbatim, so the characterization snapshots stay byte-identical.
5. Finish with the docs.

## Phase 1: Rename controllers (own commit)

### Changes

- **Rename the Inngest receipts controller.**
  - `git mv src/server/receipts/receipts.controller.ts src/server/receipts/receipts.inngest.controller.ts`.
  - Class `ReceiptsController` → `ReceiptsInngestController` (`:19`), `ReceiptsControllerDeps` → `ReceiptsInngestControllerDeps` (`:10`).
- **Rename the outbox controller.**
  - `git mv src/server/outbox/outbox.controller.ts src/server/outbox/outbox.inngest.controller.ts`.
  - `OutboxController` → `OutboxInngestController` (`:15`), `OutboxControllerDeps` → `OutboxInngestControllerDeps` (`:5`).
- **Rename the email controller.**
  - `git mv src/server/email/email.controller.ts src/server/email/email.http.controller.ts`.
  - `EmailController` → `EmailHttpController` (`:19`), `EmailControllerDeps` → `EmailHttpControllerDeps` (`:7`).
- **Rename the three tests with them and update their imports, `new` calls and `describe` names:**
  - `receipts.inngest.controller.test.ts` (was `receipts.controller.test.ts:2,30,39`)
  - `outbox.inngest.controller.test.ts` (was `:2,25,34`)
  - `email.http.controller.test.ts` (was `:21,62,85`)
- `src/server/inngest/functions.ts:7,9,19,33` — update imports and `new` calls. The local variable names stay.
- `src/server/inngest/registry-golden.test.ts:2,3,37,38` — update imports and `new` calls only. The pinned ids and triggers do not change.
- `src/app/api/receipts/inbound/route.ts:6,24,26,29` — update the import, types and `new` call.
- `src/app/api/receipts/inbound/route.test.ts:44-45` — update the `vi.mock` path and the mocked class key, and fix the comment at `:6`.
- `.claude/rules/server-architecture.md` — tier-map row `:25` becomes `<domain>.<transport>.controller.ts` (transport = `inngest` | `http` | `trpc`). `:151` `OutboxController` becomes `OutboxInngestController`.
- `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80` — Implementation status "Done" uses the new class names. adr021's context (`:14`) describes the before-state and stays as is.

### Success

- [x] `make check` passes
- [x] `make test` passes, and `registry-golden.test.ts` asserts the same ids and triggers as before
- [x] `git grep -nE "\b(ReceiptsController|OutboxController|EmailController)(Deps)?\b" src .claude/rules` returns nothing
- [x] The phase is a single commit containing only the renames

## Phase 2: Characterize transactions and Consumed

Tests only. No `src` behaviour changes.

### Changes

- **New `src/server/db/recording-db.fake.ts`:** test-only stand-in for `db`, built on `drizzle-orm/pg-proxy`.
  - `recordingDb(respond?)` returns `{ db, queries }`.
  - Every query appends `{ sql, params, method }` to `queries`.
  - `respond(query)` returns row arrays in select-field order (pg-proxy `"all"` mode) or an `Error` to throw. It defaults to `[]`.
  - Match responses by SQL text, not call order, so `Promise.all` in `list` and `summary` can't swap them.
  - Also export `pgError(code)`, which makes a driver-shaped `Error` with `code`. pg-proxy wraps it in `DrizzleQueryError`, the same `.cause` shape `parse-error.ts:45-51` unwraps in production.
- **New `src/server/api/routers/transaction.test.ts`: characterization over the unchanged routers.**
  - **Harness.**
    - Build a local `createTRPCRouter({ transaction: transactionRouter, expense: expenseRouter })`.
    - Call it through `createCallerFactory` with `{ db, session: { user: { id: "member-1" } }, headers }` cast once.
    - Keep the `~/server/db` / `~/server/auth` stubs from `setting.test.ts:4-7` for now.
    - A `rowOf(fields, fixture)` helper orders fixture values by `getTableColumns(transactions)` keys.
  - **What each case pins.**
    - SQL text and params go in `toMatchInlineSnapshot`.
    - Codes and messages use `toMatchObject`.
  - **`list`:**
    - The default query: two left joins, `order by date desc, id desc`, `limit 50` (Drizzle omits a zero offset; a separate case pins `offset`), plus the count query. `total` comes from the count row.
    - Every filter: `search` → `ilike` on description, Group (`category`) and notes; `priority`; `frequency`; Group; `from`; `to`.
    - Each `sortBy` key with `sortDir: "asc"`.
  - **`summary`:** the five queries' SQL, and zero totals when the totals row is missing.
  - **`create`:**
    - The insert SQL and params, and the returned row.
    - `pgError("23503")` → `CONFLICT` "The selected expense or category no longer exists." with a cause.
    - `pgError("23505")` → `INTERNAL_SERVER_ERROR` (not mapped).
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to create transaction.".
  - **`update`:**
    - The update SQL and params.
    - Empty `returning` → `NOT_FOUND` "Transaction not found.".
    - `23503` → `CONFLICT` with the same message as `create`.
  - **`unplanned`:**
    - The SQL: `amount > 0`, `expense_id is null`, a half-open date window, order by Group asc, date desc, id desc.
    - An inverted window → `BAD_REQUEST` with zero queries.
  - **`linkExpense`:**
    - The update sets only `expense_id`.
    - `23503` → `CONFLICT` "The selected expense no longer exists.".
    - Empty `returning` → `NOT_FOUND`.
  - **`delete`:** the delete SQL, and the result `{ success: true }`.
  - **`expense.consumption`:** the SQL (`sum` grouped by `expense_id`, where it is not null). A staged row `[7, "12.5"]` → `[{ expenseId: 7, consumed: 12.5 }]`, which pins `mapWith(Number)`.
  - **Signed out:** `session: null` → `UNAUTHORIZED` with zero queries (one case).

### Success

- [x] `make check` passes
- [x] `make test` passes against the unchanged `transaction.ts` and `expense.ts`
- [x] The diff touches only the two new files

## Phase 3: Domain errors + error-mapping middleware

### Changes

- **New `src/server/errors/domain-errors.ts`:** `NotFoundError` and `ConflictError`.
  - Each `extends Error`, takes `(message: string, options?: { cause?: unknown })` and sets `name`.
  - No tRPC import.
- New `src/server/errors/domain-errors.test.ts` covers `instanceof Error`, message, cause and name.
- **Move `parse-error`.** `git mv src/server/api/lib/parse-error.ts src/server/errors/parse-error.ts`, and `parse-error.test.ts` with it. The first-line comment's "routers narrow on" becomes "services narrow on". No code change.
- **Move `assert-row`.** `git mv src/server/api/lib/assert-row.ts src/server/errors/assert-row.ts`.
  - It now throws `new Error(\`Failed to ${operation}.\`)` and drops `@trpc/server`.
  - Its comment notes that the middleware leaves the error as `INTERNAL_SERVER_ERROR` and that the message survives through `TRPCError`'s `cause.message` fallback.
- New `src/server/errors/assert-row.test.ts` checks that it returns the row, and that it throws a plain `Error` (not a `TRPCError`) with the "Failed to x." message.
- **New `src/server/errors/fk-conflict.ts`:** `rethrowFkConflict(error, message): never`.
  - It throws `new ConflictError(message, { cause: error })` when `isPgViolation(error, PgViolation.ForeignKeyViolation)`, and otherwise rethrows `error` unchanged.
  - It replaces both copies (`transaction.ts:47-52`, `receipts.ts:52-57`).
- **New `src/server/errors/fk-conflict.test.ts.`**
  - A drizzle-wrapped 23503 (the fixture shape from `receipts.match.test.ts:28-32`) → `ConflictError` with the message and cause.
  - A 23505 and a plain `Error` are rethrown as the same reference.
- **`src/server/api/lib/` becomes re-exports.** `parse-error.ts` and `assert-row.ts` there only re-export from `~/server/errors/*`, one line each, so the unmigrated routers' imports keep working until step 6.
- **`src/server/api/trpc.ts` gets the middleware.**
  - Add `errorMappingMiddleware` (design § The mapping middleware). It checks `result.error.cause instanceof NotFoundError` / `ConflictError` and throws `new TRPCError({ code, message: cause.message, cause })`. Any other result goes back unchanged. (Refined in 96c1249: it maps only a raw throw, i.e. `result.error.code === "INTERNAL_SERVER_ERROR"`, so a deliberate `TRPCError` keeps its code even with a domain-error cause; and it copies `cause.stack` so traces point at the throw site.)
  - Chain it after observability on `publicProcedure` (`:170-172`) and `protectedProcedure` (`:182-196`). The order becomes dev latency → observability → error mapping → auth.
- **Switch the routers to the shared helper.**
  - `src/server/api/routers/receipts.ts` — delete the local helper (`:50-57`) and import `rethrowFkConflict` from `~/server/errors/fk-conflict`. The unique-violation `TRPCError` at `:305-309` stays until step 6.
  - `src/server/api/routers/transaction.ts` — same swap (`:45-52`), so the file stays consistent until Phase 6 deletes it.
- **New middleware cases in `src/server/api/trpc.test.ts`:**
  - **Not found:** a procedure throwing `NotFoundError("gone")` rejects with `NOT_FOUND`, message "gone", and `.cause` being that same instance.
  - **Conflict:** `ConflictError` → `CONFLICT`, the same way.
  - **Unknown:** a plain `Error` → `INTERNAL_SERVER_ERROR`.
  - **Pass-through:** a thrown `TRPCError({ code: "BAD_REQUEST", message })` comes back with the same code and message.
  - **Observability sees the mapped code.** A `NotFoundError` leaves the span `UNSET`, with `trpc.error_code` = `NOT_FOUND` and no stdout. A `ConflictError` leaves the span `ERROR` and logs a warning, but not "trpc internal error".
  - **Protected chain:** `protectedProcedure` maps a `NotFoundError` too, and still rejects a signed-out call with `UNAUTHORIZED`.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] The CONFLICT cases in `receipts.match.test.ts:84-89,127-132,155-160` and `allowed-sender.test.ts:89-94` pass unchanged
- [x] `setting.test.ts:73-84` passes: `assertRow`'s plain `Error` still reaches the caller as `INTERNAL_SERVER_ERROR` "Failed to set fortnight anchor." (Deviation: the matcher went from a whole `new TRPCError({…})` to `{ code, message }`, because the wrapped plain `Error` now sits on `.cause`. The member sees the same thing, since `errorFormatter` never sends `cause`.)
- [x] The Phase 2 characterization tests pass with no snapshot change
- [x] `git grep -n "@trpc" src/server/errors` returns nothing

## Phase 4: `context.ts`, `ctx.services`, test caller

### Changes

- **New `src/server/api/services.ts`:** the tRPC composition root.
  - It starts as `export const services = {}` with `export type Services = typeof services`. Phase 6 adds `transactions`.
  - Services are built once at module load, and none may throw on a missing env var (design § Risk).
- **New `src/server/api/context.ts`:** `createTRPCContext` moves here from `trpc.ts:39-48`.
  - It returns `{ db, session, services, ...opts }` and exports `type Context = Awaited<ReturnType<typeof createTRPCContext>>`.
  - It imports `auth`, `db` and `services`.
- **`src/server/api/trpc.ts` stops loading `db` and `auth`.**
  - Delete the `auth`/`db` imports (`:15-16`) and the context section (`:27-48`).
  - Use `initTRPC.context<Context>()` with `import type { Context } from "./context"`.
  - Update the header comment (`:1-8`).
- `src/app/api/trpc/[trpc]/route.ts:7` — import `createTRPCContext` from `~/server/api/context`. `trpcLogger` still comes from `~/server/api/trpc`.
- `src/app/api/trpc/[trpc]/route.test.ts:7-10` — add `vi.mock("~/server/api/context", …)` for `createTRPCContext`. Keep the `trpc` mock for `trpcLogger`.
- `src/trpc/server.ts:8` — import `createTRPCContext` from `~/server/api/context`.
- **New `src/server/api/test-caller.ts`:** `createTestCaller(router, { services, session } = {})`.
  - It wraps `createCallerFactory(router)`.
  - `services` is typed `{ [K in keyof Services]?: Partial<Services[K]> }`.
  - `session` defaults to a Member (`{ user: { id: "member-1" } }`), and `null` means signed out.
  - It passes no `db`, so a controller that touches `ctx.db` fails loudly.
  - It is the only cast (one `as never`).
- **New `src/server/api/test-caller.test.ts`.**
  - With the default session, a `protectedProcedure` runs.
  - `session: null` → `UNAUTHORIZED`.
  - `ctx.services` is the object passed in.
  - `ctx.db` is `undefined`.
- `src/server/api/trpc.test.ts` — delete the `vi.mock` stubs (`:21-24`) and build `caller()` (`:45-63`) with `createTestCaller`. The prod-latency test (`:74-92`) keeps its `resetModules` re-import, now with no stubs.
- `src/server/api/routers/transaction.test.ts` — delete its `~/server/db` / `~/server/auth` stubs. This proves the router graph no longer loads them.

### Success

- [x] `make check` passes
- [x] `make test` passes, and the characterization tests show no snapshot change
- [x] `make build` passes: the RSC caller and route compile against `context.ts`, and `services.ts` loads at build without throwing (Ran as `pnpm run build`, skipping `make build`'s `rm -rf .next`, because a live `next dev` was using `.next/dev`.)
- [x] `git grep -n "server/db\|server/auth" src/server/api/trpc.ts` returns nothing
- [x] At https://personal-finance.localhost:
  - signed in, the dashboard and the Transactions page load (Checked by hand, 2026-10-01.)
  - [x] signed out, a tRPC call to `transaction.list` returns 401
- [x] `/security-review`. The session now comes from a new `context.ts`, and the auth guard sits after the new mapper (Phase 3). (No findings.)

## Phase 5: Architecture test + rules-file drift fix

### Changes

- **New `src/server/architecture.test.ts` (adr022).**
  - **Scan.**
    - Take `globSync("src/{server,app}/**/*.{ts,tsx}")` from `node:fs`, relative to the repo root as in `schema-interface-contract.test.ts:71`.
    - Skip `*.test.ts`, `*.schema.ts` (foreign keys) and `src/server/db/index.ts` (the merged-schema barrel).
    - Skip `src/app/api/health/route.ts` as a permanent exemption, with a comment: a system probe with no domain rules (design § Health stays plain).
  - **Extract specifiers** with one regex over the whole file. It covers `import … from`, `export … from`, bare `import "x"`, and multi-line `import(\s*"x"\s*)` (see `middleware.ts:145-147`). Compute line numbers from the match offset.
  - **Resolve** `~/…` → `src/…` and `./x` → the sibling path.
  - **Domain** is the first path segment under `src/server/`.
  - **Rules:**
    1. A `*.service.ts` or `*.repository.ts` imports a `*.schema` of another domain.
    2. A file imports another domain's `*.repository`, and it is not a composition root. The roots are `src/server/api/services.ts`, `src/server/inngest/functions.ts`, `*.module.ts` and `route.ts`.
    3. A `*.controller.ts` or a file under `src/server/api/routers/` imports a `*.schema`, `~/server/db`, `drizzle-orm` or `drizzle-orm/*`. A `route.ts` under `src/app` imports a `*.schema`, `drizzle-orm` or `drizzle-orm/*`. It may import `db` as a composition root.
    4. Any file matches `/\.query\.[A-Za-z_$]/`, the relational API. tRPC's `.query(` must not match.
  - **The to-do list.** `TODO` is a list of `"<rule> <file> → <specifier>"` strings.
    - One test fails on any violation not in `TODO`. It names the file:line and rule.
    - A second test fails on any `TODO` entry that no longer occurs ("delete it from the to-do list").
  - **The starting 36 entries:**
    - **Rule 1:**
      - `src/server/email/email.repository.ts` → `~/server/receipts/receipts.schema`
      - `src/server/receipts/receipts.repository.ts` → `~/server/expenses/categories.schema`
    - **Rule 3, routers.** Every router imports `drizzle-orm` plus the schemas below. `transaction.ts` also imports `drizzle-orm/pg-core`.

      | Router | Schemas imported |
      | --- | --- |
      | `allowed-sender.ts` | `auth/auth.schema`, `email/allowed-sender.schema` |
      | `balance.ts` | `balances/balances.schema` |
      | `cashflow.ts` | `balances`, `expenses`, `income`, `settings` and `transactions` schemas |
      | `category.ts` | `expenses/categories.schema`, `expenses/expenses.schema` |
      | `expense.ts` | `expenses/expenses.schema`, `transactions/transactions.schema` |
      | `income.ts` | `income/income.schema` |
      | `receipts.ts` | `auth`, `categories`, `expenses`, `receipts` and `transactions` schemas |
      | `setting.ts` | `settings/settings.schema` |
      | `transaction.ts` | `expenses/categories.schema`, `expenses/expenses.schema`, `transactions/transactions.schema` |

      That is 32 entries in total.
    - **Rule 3, routes:** `src/app/api/receipts/[id]/image/route.ts` → `drizzle-orm` and `~/server/receipts/receipts.schema`.
  - **Rule self-checks on fixture strings,** each with one hit and one miss:
    - an own-domain `./x.schema` import
    - the composition-root allowance
    - `drizzle-orm/pg-core` flagged, and `better-auth/adapters/drizzle` (`src/server/auth/config.ts:3`) not flagged
    - `.query(` not flagged
  - **Guards:**
    - The scan finds more than 100 files.
    - Every exempt path still exists, so a rename can't silently switch off an exemption.
  - **Known gaps,** recorded in a comment:
    - raw `sql` naming a foreign table
    - re-exports through a domain `index.ts`
- `src/server/outbox/index.ts:19` — delete `export { outbox } from "./outbox.schema"`, which nothing imports. This closes the only table re-export through a barrel.
- **Rewrite `.claude/rules/server-architecture.md:111-119` (Schema homes) to state adr022.**
  - A repository touches only its own domain's tables.
  - Cross-domain reads and writes go through the owning service, typed as a narrow `Pick` or port.
  - Schema files may import each other for foreign keys only.
  - `src/server/architecture.test.ts` enforces this. Its to-do list only shrinks, and each migration step deletes its entries.
  - Drop "writes are direct db calls too" and the read-join examples.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — this phase implements this decision (the test and the to-do list).

### Success

- [x] `make check` passes
- [x] `make test` passes, with exactly 36 to-do entries
- [x] Adding `import { receipts } from "~/server/receipts/receipts.schema"` to `email.http.controller.ts` fails the test, naming the file and rule 3 (scratch edit, reverted)
- [x] Deleting any one to-do entry fails the test, and so does adding an entry for a clean import
- [x] The rules file no longer says cross-domain reads or writes are direct db calls

## Phase 6: Migrate transactions (two commits)

### Changes

- **`src/domain/transactions/transaction.dto.ts` exports inferred input types** (precedent `receipt-extraction.dto.ts:27`):
  - `TransactionListQuery` (`:16-27`)
  - `TransactionCreateInput` (`:41-43`)
  - `TransactionUpdateInput` (`:45-48`)
  - `UnplannedWindow` (`:53-60`)
  - `LinkExpenseInput` (`:65-68`)

  `src/domain/transactions/index.ts` re-exports them.
- **`src/domain/transactions/transaction.interface.ts`** adds `ExpenseConsumption { expenseId: number; consumed: number }`, which is one Expense's **Consumed** (CONTEXT.md). It is re-exported from `index.ts`.
- **New `src/server/transactions/transactions.repository.ts`:** `interface TransactionsRepository` + `class DrizzleTransactionsRepository`.
  - `db` is typed `typeof realDb`, as in `outbox.repository.ts:3,46-55`.
  - No try/catch, no logging.
  - Each method lifts today's query verbatim, so the Phase 2 snapshots do not move:

    | Method | Lifted from |
    | --- | --- |
    | `list(query)` | `transaction.ts:62-124`, including the `expenses` / `expenseCategories` left joins |
    | `summary()` | `:130-187`, which returns the `TransactionSummary` with the zero-totals default |
    | `insert(values)` | `:195-198` |
    | `update(id, values)` | `:215-219` |
    | `findUnplanned(window)` | `:238-257` |
    | `setExpense(id, expenseId)` | `:266-270` |
    | `delete(id)` | `:285` |
    | `consumedByExpense()` | `expense.ts:30-45`, including `mapWith(Number)` and the non-null `expenseId` narrowing |
- **New `src/server/transactions/transactions.repository.test.ts`.**
  - It calls each repository method directly over `recordingDb()`.
  - Each method gets the SQL and params inline snapshot its procedure had in Phase 2, copied unchanged.
  - Write payloads are asserted from the recorded params.
  - This is the house "SQL text via `PgDialect` on a fake `db`, never Postgres" test. `recordingDb` renders through the real `PgDialect` instead of a hand-rolled chain, because five aggregate queries and a two-join select make a hand-rolled chain brittle.
- **New `src/server/transactions/transactions.service.ts`:** `TransactionsService`, with `interface TransactionsServiceDeps { repository: TransactionsRepository }`.
  - It holds the messages from `transaction.ts:38-43`.
  - `create` and `update` catch errors into `rethrowFkConflict(error, FK_CONFLICT_MESSAGE)`.
  - `linkExpense` uses `LINK_EXPENSE_CONFLICT_MESSAGE`.
  - `update` and `linkExpense` throw `new NotFoundError("Transaction not found.")` on a missing row, outside the try (as `:223`).
  - `create` returns through `assertRow(row, "create transaction")`.
  - `list`, `summary`, `unplanned`, `delete` (returns `void`) and `consumedByExpense` pass through.
  - No method takes `memberId`, because none reads it (design § Only where used).
- **New `src/server/transactions/transactions.service.test.ts`.** It uses an object-literal `TransactionsRepository` fake, as in `outbox.service.test.ts:62-82`.
  - A drizzle-wrapped 23503 on `create` and `update` → `ConflictError` with the message and cause.
  - The same on `linkExpense` gives the expense-only message.
  - A 23505 is rethrown unchanged.
  - A missing row on `update` or `linkExpense` → `NotFoundError` "Transaction not found.".
  - An empty `insert` → a plain `Error` "Failed to create transaction.".
  - Reads return the repository's result.
- **New `src/server/transactions/transactions.trpc.controller.ts`:** `export const transactionRouter = createTRPCRouter({ … })`.
  - The same seven procedures, the same DTOs, and the inline `delete` input from `transaction.ts:283`.
  - Each procedure makes one `ctx.services.transactions.<method>(…)` call.
  - `delete` awaits the call and returns `{ success: true }`.
  - No Drizzle, no try/catch.
- **New `src/server/transactions/transactions.trpc.controller.test.ts.** It uses `createTestCaller` with `Partial<TransactionsService>` fakes.
  - Each procedure calls its method with the parsed input. For `list` that includes the DTO defaults (`sortBy: "date"`, `sortDir: "desc"`, `limit: 50`, `offset: 0`).
  - `delete` returns `{ success: true }`.
  - A fake that throws `NotFoundError` surfaces as `NOT_FOUND` through the real middleware.
  - A signed-out call → `UNAUTHORIZED`, and the fake is never called.
- `src/server/api/services.ts` — add `transactions: new TransactionsService({ repository: new DrizzleTransactionsRepository({ db }) })`.
- `src/server/api/root.ts:9` — import `transactionRouter` from `~/server/transactions/transactions.trpc.controller`. The `transaction` key (`:26`) does not change.
- **`src/server/api/routers/expense.ts` uses the new method.**
  - `consumption` (`:28-47`) becomes `protectedProcedure.query(({ ctx }) => ctx.services.transactions.consumedByExpense())`.
  - Drop the `transactions.schema` import (`:11`), and `isNotNull` and `sql` from `:1`.
- **Commit A: the proof.**
  - Point `transaction.test.ts` at the new `transactionRouter` and the edited `expenseRouter`, through `createTestCaller`.
  - Use `services: { transactions: new TransactionsService({ repository: new DrizzleTransactionsRepository({ db: recordingDb().db as never }) }) }` and no `ctx.db`.
  - Every inline snapshot and assertion stays byte-identical and green.
- **Commit B: remove the router.**
  - Delete `src/server/api/routers/transaction.ts` and `src/server/api/routers/transaction.test.ts`.
  - The characterization cases now live elsewhere:
    - SQL goes to `transactions.repository.test.ts`.
    - Codes and messages go to `transactions.service.test.ts` and the controller test.
    - `expense.consumption`'s SQL snapshot goes to the repository test.
- **`src/server/architecture.test.ts` to-do list.**
  - Delete the 5 `routers/transaction.ts` entries and `3 src/server/api/routers/expense.ts → ~/server/transactions/transactions.schema`.
  - Add rule 1 `src/server/transactions/transactions.repository.ts` → `~/server/expenses/expenses.schema` and → `~/server/expenses/categories.schema`. These are the list's name join, which step 2 clears.
  - The list goes from 36 to 32.
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — this phase implements this decision for the reference domain.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — this phase implements it for Consumed: `expense.consumption` stops reading `transactions`.

### Success

- [x] `make check` passes
- [x] `make test` passes, and Commit A is green with no snapshot change
- [x] `make build` passes
- [x] `git grep -n "ctx.db\|drizzle-orm\|TRPCError" src/server/transactions` returns nothing (Deviation: the check was run on `transactions.service.ts` and `transactions.trpc.controller.ts` only, and returns nothing there. As written it can't pass, because the schema, the repository and their tests have to import `drizzle-orm`.)
- [x] `src/server/api/routers/transaction.ts` no longer exists, and the to-do list has 32 entries
- [x] At https://personal-finance.localhost, these behave as before (Checked by hand, 2026-10-01.):
  - the Transactions list (search, filters, sort, paging, expense and Expense Category names)
  - create, edit, link to an Expense, and delete
  - the dashboard summary
  - the Unplanned page
  - the Planned page's Consumed and Remaining
- [ ] Linking a Transaction to an Expense deleted in another tab shows "The selected expense no longer exists." (Not checked in the UI. Covered by tests: in Commit A a 23503 on `linkExpense` came back as `CONFLICT` with this message through the real middleware, and `transactions.service.test.ts` pins it.)

## Phase 7: Docs

### Changes

- **`.claude/rules/server-architecture.md`:**
  - Intro (`:12-19`) — add `src/server/transactions/` as the reference tRPC domain.
  - Tier map (`:25`) — describe the `*.trpc.controller.ts` form: a router object whose procedures do `.input()` + procedure auth + one `ctx.services.<svc>.<method>()` call, with no Drizzle and no try/catch. A procedure may call any domain's service.
  - Construction rules (`:53`) — `src/server/api/services.ts` is the tRPC composition root, and `createTRPCContext` in `context.ts` attaches it. Services hold no per-request state. Session values go in as `memberId` arguments, and only to methods that read them. A `*.module.ts` exists only when two or more composition roots need the same instance.
  - New **Errors** bullets:
    - Services throw `NotFoundError` / `ConflictError` (`src/server/errors/`), never `TRPCError`.
    - A service turns a pg violation into `ConflictError` with `isPgViolation` / `rethrowFkConflict`.
    - Repositories let driver errors bubble.
    - The error-mapping middleware owns the code.
  - New **Service split rule** subsection (design § Service split rule): split only on disjoint dependency sets or a caller needing dependencies the others never use.
  - Tests (`:79-95`) — add:
    - `*.trpc.controller.test.ts` via `createTestCaller` with `Partial<XService>` fakes and no `vi.mock`
    - `recordingDb()` (`src/server/db/recording-db.fake.ts`) as the option for query-heavy repositories
    - `architecture.test.ts` and its to-do list
  - tRPC routers (not yet migrated) (`:97-109`) — point the helper paths at `src/server/errors/`, with `src/server/api/lib/` re-exporting until step 6. Step 7 rewrites the section.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80-81` Implementation status:**
  - "Done" adds `src/server/transactions/` (`transactions.trpc.controller.ts` → `TransactionsService` → `TransactionsRepository` / `DrizzleTransactionsRepository`) and the step-1 foundation (`src/server/errors/`, the error-mapping middleware, `ctx.services` via `services.ts` / `context.ts`, `architecture.test.ts`).
  - "Next" becomes expenses and categories (step 2), per the design's order.

### Success

- [x] `make check` passes
- [x] Every path named in the edited rules-file sections exists (`git ls-files` check)
- [x] The rules file mentions no `routers/transaction.ts` and no `api/lib/` as a helper home without the re-export note

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md` (§ Migration step 1; carries `## Related ADRs`)
- ADRs:
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phases 3, 4 and 6 (renames in Phase 1)
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — implemented by Phase 5 (test + to-do list) and Phase 6 (Consumed moves to its owner)
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted) — refined, and its Implementation status is updated in Phases 1 and 7
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md` — **Member** (`:43`), **Consumed** (`:88`), **Group** (`:96`)
- Related:
  - `src/server/api/context.ts:10-20`, `src/server/api/trpc.ts:86-199`
  - `src/server/transactions/transactions.trpc.controller.ts` (replaces `src/server/api/routers/transaction.ts`, deleted in Phase 6)
  - `src/server/api/routers/expense.ts:24-27`
  - `src/server/outbox/outbox.repository.test.ts:7-86`
  - `thoughts/plans/2026-09-12-trpc-error-parser.md` (origin of `parse-error.ts`)
