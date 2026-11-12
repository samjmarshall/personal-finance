---
date: 2026-11-11
design: thoughts/designs/2026-11-09-nest-patterns-without-nest.md
adrs: [adr033]
status: Validated - Phase 1 of 9
---
# Nest patterns without Nest Implementation Plan

## Context

`src/server/` is a hand-wired 3-tier (adr004). Its wiring has started to repeat: roots build
repositories and loggers inline, three receipts routes each build the same controller, error →
transport mapping lives in two places (HTTP never maps `ConflictError`), and four routes skip
`withFlush`. We copy three Nest ideas without any Nest package: one exception-filter-style error
map per transport, `withFlush` on every route (the interceptor), and one lazy module per domain
(adr033).

## Current State

- **Errors.** `NotFoundError` / `ConflictError` / `InvalidInputError` are three unrelated
  `Error` subclasses (`src/server/errors/domain-errors.ts:4-23`). tRPC maps them by an
  `instanceof` chain (`src/server/api/trpc.ts:153-168`, `mappedError` at `:170-177`). HTTP maps
  only `UploadUnauthorizedError` → 401 and `InvalidInputError` → 400
  (`src/server/receipts/receipts.http.controller.ts:39-47`); image/html check `NotFoundError`
  by hand (`:141`, `:167`). `UploadUnauthorizedError` lives in
  `src/server/receipts/receipts.service.ts:50-54`, thrown at `:310`.
- **Routes without `withFlush`.** `src/app/api/receipts/[id]/image/route.ts:23-28`,
  `src/app/api/receipts/[id]/html/route.ts:24-29`, `src/app/api/health/route.ts:14-33`,
  `src/app/api/auth/[...all]/route.ts:5` (destructured export). `src/app/api/trpc/[trpc]/route.ts:46-59`
  wraps once, then re-exports `{ handler as GET, handler as POST }`. `src/app/api/inngest/route.ts:13-17`
  already has the target shape.
- **Modules.** Nine `*.module.ts` files export bare instances built at import
  (`src/server/outbox/outbox.module.ts:11`, `src/server/receipts/receipts.module.ts:16-26`, …).
  `receipts.module.ts:2,22-25` reads `~/env` at import. cashflow, cdr, email, income and settings
  have no module.
- **Roots.** `src/server/api/services.ts:18-50` builds income, settings, cashflow and cdr inline;
  `:26-27` warns "no service may throw on a missing env var". `src/server/inngest/functions.ts:30-90`
  builds receipt extraction, cdr sync, reconcile, a second `DrizzleCdrRepository` (`:57`), and binds
  Bedrock (`:2,41,66`). The three receipts routes each have a `compose()` memo
  (`upload/route.ts:9-22`, `image/route.ts:8-21`, `html/route.ts:9-22`); the inbound route has
  its own (`src/app/api/receipts/inbound/route.ts:23-43`) and reads env (`:49-50`).
- **Context.** `createTRPCContext` attaches `services` (`src/server/api/context.ts:1,18`);
  `src/server/api/test-caller.ts:4,11` types fakes from `Services`.
- **Enforcement.** `src/server/architecture.test.ts` has rules 1–6 (`:9-16`), roots
  (`:27-30`), `EXEMPT` (`:32-37`), an empty shrink-only `TODO` (`:40`), `isCompositionRoot`
  (`:62-65`), rule 2 (`:88-94`) and its unit case (`:201-205`). Biome 2.6.4 is installed;
  `biome.jsonc:44-73` sets no `suspicious` rules. `suspicious.noImportCycles` exists in its schema.
- **Env.** `src/env.ts:136` `RESEND_WEBHOOK_SECRET: requiredInProd(z.string())`. Vitest sets
  `SKIP_ENV_VALIDATION=1` and `unstubEnvs: true` (`vitest.config.ts:10,13`).
- **Spike (2026-11-11).** Under the empty test env, importing the real
  `~/server/auth/session-reader`, `services` and `functions` throws nothing, and
  `functions.map((fn) => fn.id())` gives the bare ids pinned in
  `src/server/inngest/registry-golden.test.ts:46-78`.
- **Docs.** adr033 is `Proposed` (`docs/adr/adr033-…-no-nest.md:2`). The working tree already
  has adr004's "Replaced by adr033" tag on its module bullet (`docs/adr/adr004-…md:68`) and its
  Links line (`:162`), not yet committed. No Terraform under `infrastructure/` keys on the log
  `component` values this plan renames.

## Desired End State

- `DomainError` with `kind` is the base of the four domain errors. `Record<DomainErrorKind, …>`
  maps exist for tRPC (`trpc.ts`) and HTTP (`src/server/errors/http-status.ts`). A new kind fails
  `make check` until both maps cover it. HTTP answers 409 for `ConflictError`.
- Every method exported from `src/app/api/**/route.ts` is `export const <METHOD> = withFlush(…)`,
  checked by rule 7.
- Every domain has `<domain>.module.ts` exporting `<domain>Module = once(() => ({ … }))`. The
  transactions, receipts and cdr domains also have a `*.worker.module.ts`. `services.ts` is
  `once(() => ({ … }))` built only from module calls. `functions.ts` is four spreads of module
  `functions`. Each `route.ts` method is one module call. No `compose()` memo remains.
- `architecture.test.ts` enforces rules 1, 3–12 with an empty `TODO`. Biome
  `suspicious.noImportCycles` is on.
- `src/server/modules.smoke.test.ts` builds every module, `services()` and `functions` under an
  empty env and under a fake-integrations env.
- adr033 is `Accepted`; `.claude/rules/server-architecture.md` and
  `.claude/rules/bedrock-invocation.md` describe the module rule.

## Out of Scope

- A guard, a pipe, a full filter (shared HTTP error body / log level / span), a bigger interceptor,
  a DI container, any `@nestjs/*` package, `<domain>.contracts.ts`, events-first calls (design
  "When to revisit").
- Moving members out of `src/server/auth/`.
- Per-route HTTP error bodies (they stay as they are), and the four non-domain errors
  (`ReceiptTooLargeError`, `RedisUnavailableError`, `RedbarkRetryableError`, `CdrSyncError`).
- Any FROZEN identifier: event names, Inngest function ids, triggers, concurrency keys.
- A `once()` reset helper and an `overrides` argument on module factories.

## Approach

Three tracks of small PRs (design decision 12). Phases 1 and 2 are independent and can land in
either order. Phase 3 lays the groundwork: `once()`, the new architecture rules with every current
gap listed in `TODO`, `noImportCycles`, and the smoke test, which acts as the characterization net
for the migrations. Phases 4–9 migrate one domain per PR, leaves first. Each one adds its module
to the smoke test and deletes its `TODO` lines, so the last leaves `TODO` empty. A worker module
builds its own repository, because a module never returns one. Repositories are stateless, so the
second build is cheap.

## Phase 1: Errors — `DomainError` + `kind`, one map per transport

### Changes

- `src/server/errors/domain-errors.ts` — add
  `type DomainErrorKind = "not_found" | "conflict" | "invalid_input" | "unauthorized"` and
  `abstract class DomainError extends Error` with `abstract readonly kind: DomainErrorKind` and
  constructor `(message, options?: { cause?: unknown })`. `NotFoundError`, `ConflictError`,
  `InvalidInputError` extend it with `readonly kind = "…" as const`. Each keeps its literal
  `this.name`, because minified class names can't be trusted. Add `UnauthorizedError` (kind
  `unauthorized`). Constructors stay `(message, { cause })`, so throw sites don't change.
- `src/server/errors/domain-errors.test.ts` — add `UnauthorizedError` to the `describe.each`.
  Assert each is `instanceof DomainError` and carries its `kind`.
- `src/server/errors/http-status.ts` — new.
  `const HTTP_STATUS: Record<DomainErrorKind, number> = { not_found: 404, conflict: 409, invalid_input: 400, unauthorized: 401 }`
  and `httpStatusFor(error: unknown): number | undefined`, which returns `undefined` for anything
  that isn't a `DomainError`. Imports nothing from tRPC.
- `src/server/errors/http-status.test.ts` — one case per kind. `undefined` for a plain `Error`
  and for a thrown non-`Error`.
- `src/server/api/trpc.ts:153-168` — replace the `instanceof` chain with
  `const TRPC_CODE: Record<DomainErrorKind, TRPCError["code"]> = { not_found: "NOT_FOUND", conflict: "CONFLICT", invalid_input: "BAD_REQUEST", unauthorized: "UNAUTHORIZED" }`
  and `if (cause instanceof DomainError) throw mappedError(TRPC_CODE[cause.kind], cause)`. Keep
  the `INTERNAL_SERVER_ERROR`-only guard (`:156`) and `mappedError`'s stack copy (`:170-177`).
- `src/server/api/trpc.test.ts` — the existing "error mapping" cases (`:232-320`) are the
  characterization net; run them green before the edit. Add "maps an UnauthorizedError to
  UNAUTHORIZED, keeping its message and cause".
- `src/server/receipts/receipts.service.ts:48-54,310` — delete `UploadUnauthorizedError`. Throw
  `new UnauthorizedError("Unauthorized")`, and move the "a class survives Blob's passthrough"
  comment to the throw site.
- `src/server/receipts/receipts.service.test.ts:33,867` — expect `UnauthorizedError`.
- `src/server/receipts/receipts.http.controller.ts`:
  - `:39-47` `failureStatus` returns `httpStatusFor(error) ?? (type === "blob.upload-completed" ? 400 : 500)`
    as `number`.
  - `:141,167` become `if (httpStatusFor(error) === 404) return notFound()`.
  - In the upload catch (`:224-262`): 401 logs a warn and leaves the span clean; any other
    status `< 500` calls `failSpan` and logs a warn; `>= 500` calls `failSpan` and logs an error.
    The body shows `error.message` when `status < 500`, otherwise "Upload failed".
  - Drop the `UploadUnauthorizedError` import (`:11-14`).
- `src/server/receipts/receipts.http.controller.test.ts` — the existing upload status cases
  (`:416-500`) are the characterization net. Switch `:29,90` to `UnauthorizedError`. Add "409s a
  ConflictError from the mint with a warn log and an errored span".
- `.claude/rules/server-architecture.md:109-125` (Errors) — `DomainError` + `kind`; the two maps
  and where they live; `UnauthorizedError`; "a new kind fails the typecheck until both maps cover
  it"; the four errors that are not domain errors. Replace the `instanceof` mapping bullet
  (`:119-121`).

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] Adding a fifth `DomainErrorKind` member locally fails `make check` in both `trpc.ts` and
      `http-status.ts` (try it, then revert)
- [x] `grep -rn UploadUnauthorizedError src` finds nothing
- [x] `grep -rn "@trpc" src/server/errors` finds nothing

## Phase 2: Interceptor — `withFlush` on every route (rule 7)

### Changes

- `src/server/architecture.test.ts` — add rule 7, "a route method is not wrapped in `withFlush`".
  - Scan every `globSync("src/app/api/**/route.ts")`, health included. `EXEMPT` (`:32-37`) waives
    only the import rules, so rule 7 does not consult it.
  - Methods: `GET|HEAD|POST|PUT|DELETE|PATCH|OPTIONS`.
  - Flag `export (async )?function <M>`, a destructured `export const { …<M>… } =`, any
    `export { … <M> … }` (incl. `x as <M>` and `… from`), and `export const <M> =` not followed
    by `withFlush(`.
  - Report as `{ rule: 7, file, line, specifier: <M> }`.
  - Unit cases: allows `export const GET = withFlush(handlers.GET);`. Flags
    `export async function GET()`, `export const { GET, POST } = toNextJsHandler(x);`,
    `export { handler as GET };` and `export const POST = handler;`. Ignores
    `export const maxDuration = 300;`.
- `src/app/api/receipts/[id]/image/route.ts:23-28` and
  `src/app/api/receipts/[id]/html/route.ts:24-29` — use
  `export const GET = withFlush(async (request: Request, ctx: { params: Promise<{ id: string }> }) => compose().image(request, (await ctx.params).id))`
  (`.html` for html).
- `src/app/api/receipts/[id]/image/route.test.ts`, `src/app/api/receipts/[id]/html/route.test.ts` —
  mock `~/server/observability/sdk/flush` with `flush.fake` as `upload/route.test.ts:8-11` does,
  and assert `flushAfterResponse` runs once per request.
- `src/app/api/health/route.ts:14-33` — use `export const GET = withFlush(async (): Promise<Response> => { … })`.
  `await connection()` stays first inside, outside the `try`. `after()` doesn't make a route
  dynamic (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:40`), so
  `connection()` is still what keeps it from prerendering.
- `src/app/api/health/route.test.ts` — add the flush mock and assert one flush per call.
- `src/app/api/auth/[...all]/route.ts:5` — use `const handlers = toNextJsHandler(auth.handler)`;
  `export const GET = withFlush(handlers.GET)`; `export const POST = withFlush(handlers.POST)`, as
  `src/app/api/inngest/route.ts:13-17` does.
- `src/app/api/trpc/[trpc]/route.ts:46-59` — `handler` is the unwrapped
  `(req: NextRequest) => fetchRequestHandler(…)`. Add `export const GET = withFlush(handler)` and
  `export const POST = withFlush(handler)`, and delete the re-export.
- `.claude/rules/server-architecture.md:83-88` — every route method is `export const <M> = withFlush(…)`
  (rule 7).

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes, and its route table still lists `/api/health` as dynamic (ƒ)
- [ ] Rule 7 reports no violations, and `TODO` stays empty
- [ ] `/security-review` (touches `src/app/api/auth/**`)

## Phase 3: Module groundwork — `once()`, rules 8–12, smoke test, docs

### Changes

- `src/lib/once.ts` — new. `once<T>(build: () => T): () => T` builds on the first call and
  returns the cached value after that. It never calls `build` at definition. A throw caches
  nothing.
- `src/lib/once.test.ts` — tests that `build` is never called at definition, runs once across
  calls and returns the same reference, and that after a throw the next call builds again.
- `src/server/api/services.ts` — becomes `export const services = once(() => ({ … }))`, with the
  same 11 keys and the inline income/settings builds moved inside, plus
  `export type Services = ReturnType<typeof services>`. Replace the `:26-27` comment with "Built on
  first use; module factories never throw (adr033)".
- `src/server/api/context.ts:18` — `services: services()`. `test-caller.ts:4,11` needs no change
  (it derives from `Services`).
- `src/server/architecture.test.ts` — implements adr033's enforcement:
  - `DOMAINS` = folders of `globSync("src/server/*/*.service.ts")`, asserted to equal the 13
    domains (allowed-senders, auth, balances, cashflow, categories, cdr, email, expenses, income,
    outbox, receipts, settings, transactions).
  - Delete rule 2 (`:88-94`). Rule 11 covers it. Convert its unit case (`:201-205`) to rule 11.
    `functions.ts` → `outbox.repository` is now `[11]`.
  - Rule 5 keeps `isCompositionRoot` (`:62-65`): `services.ts`, `functions.ts`, `route.ts`,
    `*.module.ts`.
  - Rule 8: a `*.service.ts` / `*.repository.ts` / `*.controller.ts` imports `src/env`.
  - Rule 9: a target ending `.worker.module` imported by anything but
    `src/server/inngest/functions.ts` or another `*.worker.module.ts`. Checked before rule 5.
  - Rule 10: a target under `src/server/aws/` imported from outside `*.worker.module.ts` and
    outside `src/server/aws/` itself.
  - Rule 11: the target sits in a domain other than the file's own, and one of these holds:
    - it is a `*.schema` / `*.repository`, imported in any form;
    - it is a value import of anything but that domain's `*.module`.

    A type-only import (`import type …`, or a named list where every binding is `type`) is
    allowed. Dynamic `import()` and `export … from` count as value imports. Exceptions: target
    `src/server/auth` or `src/server/auth/server` (the better-auth instance); file
    `src/server/api/root.ts` → `*.trpc.controller`. `db/index.ts` and `*.schema.ts` files are
    already outside the scan (`:148-153`). Checked last, so existing rule numbers keep their keys.
  - Rule 12: a `DOMAINS` folder with no non-worker `*.module.ts`. Report as
    `{ rule: 12, file: "src/server/<d>", line: 0, specifier: "*.module.ts" }`.
  - Unit cases per rule:
    - Rule 8: `x.service.ts` → `~/env` gives `[8]`; `x.module.ts` gives `[]`.
    - Rule 9: `services.ts` and `receipts.module.ts` → a worker module give `[9]`;
      `functions.ts` and `cdr.worker.module.ts` → a worker module give `[]`.
    - Rule 10: `functions.ts` → `~/server/aws/bedrock` gives `[10]`; a worker module or
      `src/server/aws/bedrock.ts` → `./credentials` gives `[]`.
    - Rule 11, allowed: `import type` and `{ type A, type B }` from another domain's service; a
      route → `*.module`; `root.ts` → `*.trpc.controller`; a page → `~/server/auth/server`;
      an infra target (`~/server/blob-store/blob-store`).
    - Rule 11, flagged: a value import of another domain's service; `import type` of another
      domain's repository.
  - Rename the describe to `architecture (adr022, adr033)`, and add rules 7–12 to `RULES`.
  - `TODO` gets every live violation. Rule 8 and rule 9 have none today. The expected list:
    - `10 src/server/inngest/functions.ts → ~/server/aws/bedrock`
    - `11 src/server/api/services.ts →` `~/server/cdr/cdr.repository`, `~/server/cdr/cdr.service`,
      `~/server/income/income.repository`, `~/server/income/income.service`,
      `~/server/settings/settings.repository`, `~/server/settings/settings.service`,
      `~/server/cashflow/cashflow.service`
    - `11 src/server/inngest/functions.ts →` `~/server/cdr/cdr.repository`,
      `~/server/cdr/cdr-sync.service`, `~/server/cdr/cdr.inngest.controller`,
      `~/server/cdr/cdr.redbark`, `~/server/outbox/outbox.inngest.controller`,
      `~/server/receipts/receipt-extraction.repository`,
      `~/server/receipts/receipt-extraction.service`,
      `~/server/receipts/receipts.inngest.controller`,
      `~/server/transactions/transactions.repository`,
      `~/server/transactions/transaction-reconcile.service`,
      `~/server/transactions/transactions.inngest.controller`
    - `11 src/app/api/receipts/{upload,[id]/image,[id]/html}/route.ts →`
      `~/server/auth/session-reader`, `~/server/receipts/receipts.http.controller`
    - `11 src/app/api/receipts/inbound/route.ts →` `~/server/email/email.http.controller`,
      `~/server/email/email.mailbox`, `~/server/email/email.service`
    - `12 src/server/{cashflow,cdr,email,income,settings} → *.module.ts`

    If the test finds a different set, the test is the source of truth: list what it reports.
- `biome.jsonc:44-73` — add `"suspicious": { "noImportCycles": "error" }` under `linter.rules`.
- `src/server/modules.smoke.test.ts` — new.
  - A `MODULES` table of `[name, () => import(…).then((m) => m.xModule), expectedKeys]`, empty in
    this phase; each later phase adds rows.
  - `describe.each` over two envs:
    - **empty**: no stubs. Under `SKIP_ENV_VALIDATION` every value is `undefined`.
    - **integrations set**: `vi.stubEnv` for `REDBARK_API_KEY`, `REDBARK_API_URL`,
      `RESEND_API_KEY` (`re_test`), `RESEND_WEBHOOK_SECRET` (`whsec_dGVzdA==`) and
      `BLOB_PATH_PREFIX`.
  - `beforeEach` calls `vi.resetModules()`, then a dynamic import, because `~/env` is read at import.
  - Per env, assert:
    - each module factory builds without throwing and returns exactly its keys;
    - `Object.keys(services()).sort()` equals the 11 keys;
    - `functions.map((fn) => fn.id()).sort()` equals
      `["cdr-import", "cdr-sync", "duplicate-apply", "outbox-prune", "outbox-sweep", "process-receipt"]`.
      A comment says the list mirrors `registry-golden.test.ts`. Importing from that file would
      run its tests twice.
  - Never queries.
- `docs/adr/adr033-…-no-nest.md`:
  - `:2` Status → `'Accepted'`.
  - Reword the `:71` positive consequence: each `DrizzleCdrRepository` / `DrizzleTransactionsRepository`
    build sits in its domain's module and worker module, not in a root. A worker module builds its
    own repository because modules never return one.
- `docs/adr/adr004-…md:68,162` — commit the working-tree "Replaced by adr033" tag and Links
  line.
- `.claude/rules/server-architecture.md`:
  - `:33` module row: a module per domain, `once()`, export keys, null for an unset optional
    integration. Add a worker-module row.
  - `:72-82` composition roots: `services = once(…)`; `functions.ts` spreads module
    `functions`; module factories never throw; tiers never import `~/env`.
  - `:83-88` route roots: one module call per method, no `compose()` memo.
  - `:168-173` tests: rules 7–12, the smoke test, `route.test.ts` mocks the module.
  - Cross-domain calls: `Pick<…>` sync, outbox async, `import type` allowed except
    schema/repository.
- `.claude/rules/bedrock-invocation.md` — add `src/server/**/*.worker.module.ts` to `paths:`
  (`:2`). Add a bullet: only `*.worker.module.ts` imports `~/server/aws/` (rule 10).

### Success

- [ ] `make check` passes (incl. `noImportCycles`)
- [ ] `make test` passes, the smoke test included, in both envs
- [ ] `make build` passes
- [ ] Each new rule's unit cases fail when its check is commented out
- [ ] `/security-review` (adds `src/lib/once.ts`)

## Phase 4: Small domains — one PR per domain, in this order

Each PR follows the same steps:

- Rewrite or create `<domain>.module.ts` as `export const <domain>Module = once(() => ({ … }))`.
- Switch every caller from the bare instance to `<domain>Module().<key>`. Unmigrated modules call
  it at their own import, which is safe because factories never throw.
- Add the domain's row to `MODULES` in the smoke test.
- Delete its `TODO` lines.

### Changes

- **outbox** — `src/server/outbox/outbox.module.ts`: `service` (logger
  `{ outbox, service }`) and `functions: new OutboxInngestController({ inngest, service }).functions`.
  Callers: `receipts.module.ts:9,17`, `transactions.module.ts:4,10`,
  `duplicate-apply.module.ts:3,10`, `services.ts:11,40`, `functions.ts:14,30-33,52,57`.
  `functions.ts` spreads `...outboxModule().functions`. Clears
  `11 functions.ts → ~/server/outbox/outbox.inngest.controller`. Smoke row
  `["functions", "service"]`.
- **categories** — `categories.module.ts`: `service`. Callers: `services.ts:4,38`,
  `functions.ts:5,37`, `receipts.module.ts:6,21`, `transactions.module.ts:1,12`. Smoke `["service"]`.
- **members** — `src/server/auth/members.module.ts`: `service` and
  `sessions: new BetterAuthSessionReader()`.
  - Callers: `allowed-senders.module.ts:1,10`, `receipts.module.ts:3,18`.
  - `upload/route.ts`, `[id]/image/route.ts` and `[id]/html/route.ts` swap
    `new BetterAuthSessionReader()` for `membersModule().sessions` and drop the session-reader import.
  - Their `route.test.ts` files mock `~/server/auth/members.module` instead of
    `~/server/auth/session-reader`.
  - Clears the three `→ ~/server/auth/session-reader` lines. Smoke `["service", "sessions"]`.
- **allowed-senders** — `allowed-senders.module.ts`: `service`. Callers: `services.ts:1,29`,
  `inbound/route.ts:4,33`. `inbound/route.test.ts:20-22` mocks
  `allowedSendersModule: () => ({ service: {} })`. Smoke `["service"]`.
- **balances** — `balances.module.ts`: `service`. Callers: `services.ts:2,30,36`,
  `functions.ts:3,72`. Smoke `["service"]`.
- **expenses** — `expenses.module.ts`: `service`. Callers: `services.ts:8,33,43`,
  `receipts.module.ts:8,20`, `transactions.module.ts:3,11`. Smoke `["service"]`.
- **settings** — new `src/server/settings/settings.module.ts`: `service`. `services.ts:13-14,22-24,35,46`
  uses `settingsModule().service`. Clears `11 services.ts → settings.repository / settings.service`
  and `12 src/server/settings`. Smoke `["service"]`.
- **income** — new `src/server/income/income.module.ts`: `service`. `services.ts:9-10,18-20,34,44`
  uses `incomeModule().service`. Clears `11 services.ts → income.repository / income.service` and
  `12 src/server/income`. Smoke `["service"]`.

### Success

- [ ] `make check` passes after each PR
- [ ] `make test` passes after each PR, smoke rows included
- [ ] None of the eight module files exports a bare instance. `grep -rn "export const .*Service = new" src/server`
      matches none of them.
- [ ] `/security-review` on the members PR (touches `src/server/auth/**`)

## Phase 5: transactions — fold in duplicate-apply, add the worker module

### Changes

- `src/server/transactions/transactions.module.ts` — rewrite:
  - One `DrizzleTransactionsRepository({ db, outbox: outboxModule().service })`.
  - `service` (`TransactionsService` over expenses/categories modules).
  - `duplicateApply` (`DuplicateApplyService`, logger `{ transactions, apply }`).
  - `functions: new TransactionsInngestController({ inngest, service: duplicateApply }).functions`.
- `src/server/transactions/duplicate-apply.module.ts` — delete.
- `src/server/transactions/transactions.worker.module.ts` — new. `reconcile`:
  `TransactionReconcileService` over its own `DrizzleTransactionsRepository`,
  `embeddingModel: bedrock.embedding(env.BEDROCK_EMBEDDING_MODEL)` read inside `once()`, and logger
  `{ transactions, reconcile }`.
- `src/server/inngest/functions.ts`:
  - Drop `:18-21,50-53,64-71,80-83`.
  - The cdr sync takes `transactions: transactionsWorkerModule().reconcile`.
  - Spread `...transactionsModule().functions`.
- `src/server/api/services.ts` — `duplicateApply: transactionsModule().duplicateApply`,
  `transactions: transactionsModule().service`, and cashflow's `transactions` dep likewise.
- `src/server/receipts/receipts.module.ts:10,19` — `transactionsModule().service`.
- Smoke rows: transactions `["duplicateApply", "functions", "service"]`, transactions.worker
  `["reconcile"]`.
- Clears `11 functions.ts →` `transactions.repository`, `transaction-reconcile.service`,
  `transactions.inngest.controller`.
- `.claude/rules/bedrock-invocation.md` — the embedding model is bound in
  `transactions.worker.module.ts`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes (`registry-golden.test.ts` unchanged and green)
- [ ] `make build` passes
- [ ] `transactions.worker.module.ts` is imported only by `functions.ts` (rule 9 green)

## Phase 6: receipts — module with `http`, worker module, routes become one call

### Changes

- `src/server/receipts/receipts.module.ts` — rewrite as `receiptsModule = once(() => { … })`.
  - Read `env` inside the factory (no import-time read).
  - Build `ReceiptsService` over `outboxModule()`, `membersModule()`, `transactionsModule()`,
    `expensesModule()` and `categoriesModule()`.
  - `http: new ReceiptsHttpController({ service, sessions: membersModule().sessions, logger: …{ receipts, http } })`.
- `src/server/receipts/receipts.worker.module.ts` — new.
  - `ReceiptExtractionService` (repository, `categoriesModule().service`, `VercelBlobStore`,
    `languageModel: bedrock(env.BEDROCK_RECEIPT_MODEL)`, logger `{ receipts, extraction }`,
    `errorReporter: { captureException }`).
  - Returns `functions: new ReceiptsInngestController({ inngest, service }).functions`.
- `src/app/api/receipts/upload/route.ts` — `export const POST = withFlush((request: Request) => receiptsModule().http.upload(request))`.
  Delete `compose()`.
- `src/app/api/receipts/[id]/image/route.ts`, `[id]/html/route.ts` — `withFlush(async (request, ctx) => receiptsModule().http.image(request, (await ctx.params).id))`
  (`.html`). Delete `compose()`.
- The three `route.test.ts` — mock `~/server/receipts/receipts.module` as
  `{ receiptsModule: () => ({ http: fake }) }`. Assert delegation with the request (and id) plus
  one flush per call. Drop the controller-class, session-reader and logger mocks.
- `src/app/api/receipts/inbound/route.ts:11,34` — `receiptsModule().service` (until Phase 8).
  Its test mocks `receiptsModule`.
- `src/server/api/services.ts` — `receipts: receiptsModule().service`.
- `src/server/inngest/functions.ts` — drop the receipts builds and the `bedrock`, `env`,
  `VercelBlobStore` and `captureException` imports. Spread `...receiptsWorkerModule().functions`.
- Smoke rows: receipts `["http", "service"]`, receipts.worker `["functions"]`.
- Clears `10 functions.ts → ~/server/aws/bedrock`, `11 functions.ts →` the three receipts
  entries, and the three routes' `→ receipts.http.controller` lines.
- `.claude/rules/bedrock-invocation.md:15` — the receipt model is bound in
  `receipts.worker.module.ts`.
- Log `component` changes, recorded in adr033:
  - `upload-route`, `image-route` and `html-route` become `http`;
  - receipt extraction moves from `service` to `extraction`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `grep -rn "compose()" src/app/api/receipts/upload src/app/api/receipts/\[id\]` finds nothing
- [ ] Rule 10 has no `TODO` entry, and `grep -rn "server/aws" src --include='*.ts' | grep -v test`
      lists only the two `*.worker.module.ts` files and `src/server/aws/` itself
- [ ] Receipt upload, image view and e-receipt view work on the branch preview; `/api/receipts/upload`
      logs carry `component: "http"`

## Phase 7: cdr — module and worker module

### Changes

- `src/server/cdr/cdr.module.ts` — new. `service: new CdrService({ repository: new DrizzleCdrRepository({ db, outbox: outboxModule().service }) })`.
- `src/server/cdr/cdr.worker.module.ts` — new.
  - `CdrSyncService` over its own `DrizzleCdrRepository`, with
    `redbark: env.REDBARK_API_KEY ? new HttpRedbarkClient({ apiKey, baseUrl: env.REDBARK_API_URL }) : null`
    (adr017 no-op), `transactions: transactionsWorkerModule().reconcile`,
    `balances: balancesModule().service` and logger `{ cdr, sync }`.
  - Returns `functions: new CdrInngestController({ inngest, service }).functions`.
- `src/server/inngest/functions.ts` — final shape:
  `export const functions = [...outboxModule().functions, ...transactionsModule().functions, ...receiptsWorkerModule().functions, ...cdrWorkerModule().functions]`
  with module imports only. Replace the header comment (`:25-29`).
- `src/server/api/services.ts` — `cdr: cdrModule().service`.
- Smoke rows: cdr `["service"]`, cdr.worker `["functions"]`. The integrations-set env builds the
  Redbark client branch.
- Clears `11 services.ts → cdr.repository / cdr.service`, `11 functions.ts →` the four cdr
  entries, and `12 src/server/cdr`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `functions.ts` imports only `*.module.ts` / `*.worker.module.ts` files

## Phase 8: email — module with nullable `http`

### Changes

- `src/server/email/email.module.ts` — new. `emailModule = once(() => { … })`.
  - Reads `env.RESEND_API_KEY` and `env.RESEND_WEBHOOK_SECRET` inside the factory, and returns
    `{ http: null }` when either is unset.
  - Otherwise builds one `new Resend(apiKey)` and returns `http`: an `EmailHttpController` over an
    `EmailService`.
  - The service takes `allowedSendersModule().service`, `receiptsModule().service`,
    `ResendInboundMailbox`, `VercelBlobStore({ prefix: env.BLOB_PATH_PREFIX })` and logger
    `{ email, service }`.
  - The controller logger becomes `{ email, http }`, renamed from `controller`.
- `src/app/api/receipts/inbound/route.ts` — delete `compose()` and the env reads (`:20-62`).
  - `POST = withFlush(async (request: Request) => { const http = emailModule().http; … })`.
  - When `http` is `null`, keep the `email.route.unconfigured` error log (logger
    `{ email, route }`) and return 500. Otherwise `return http.handle(request)`.
  - Keep `maxDuration = 60`.
- `src/app/api/receipts/inbound/route.test.ts` — mock `~/server/email/email.module` with a
  settable `http`. When it is `null`: 500, an error log, and a flush. When set: delegates the
  request, and flushes. Drop the `~/env`, `resend` and tier-class mocks.
- `src/env.ts:136` — `RESEND_WEBHOOK_SECRET: requiredInProd(z.string().startsWith("whsec_"))`, so
  a malformed Svix secret fails at startup. Update its JSDoc (`:124-129`) to say so.
- Smoke row: email `["http"]`. Assert `http` is `null` in the empty env and non-null in the
  integrations-set env.
- Clears `11 inbound/route.ts →` the three email entries, and `12 src/server/email`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes with the current `.env`
- [ ] The inbound route still 500s with `email.route.unconfigured` when either Resend key is unset
- [ ] `/security-review` (touches `src/env.ts`)

## Phase 9: cashflow — last module, empty `TODO`

### Changes

- `src/server/cashflow/cashflow.module.ts` — new. `service: new CashflowService({ transactions: transactionsModule().service, expenses: expensesModule().service, income: incomeModule().service, settings: settingsModule().service, balances: balancesModule().service })`.
- `src/server/api/services.ts` — final shape: every entry is a module call
  (`cashflow: cashflowModule().service`), with module imports only.
- Smoke row: cashflow `["service"]`.
- `src/server/architecture.test.ts:40` — `TODO` is `[]`.
- `.claude/rules/server-architecture.md` — drop any rollout-only wording ("unmigrated", the
  `TODO` gaps). The reference implementations name `receipts.module.ts` /
  `receipts.worker.module.ts`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `TODO` in `architecture.test.ts` is empty, and every one of the 13 domains has a `*.module.ts`
- [ ] `services.ts` and `functions.ts` import only module files (plus `~/lib/once` in `services.ts`)

## References

- Design doc: `thoughts/designs/2026-11-09-nest-patterns-without-nest.md` (carries `## Related ADRs`)
- ADRs: `docs/adr/adr033-every-domain-owns-a-lazy-module-worker-deps-in-worker-modules-no-nest.md`
  (Proposed) — implemented by Phase 3 (groundwork, Status → Accepted) through Phase 9 (last
  domain)
- Composes with (Accepted): adr004 (3-tier construction), adr002 (outbox for async calls), adr015
  (telemetry flush), adr017 (Redbark unset = no-op), adr022 (cross-domain data through the owning
  service)
- Related: `src/server/architecture.test.ts:9-118`, `src/server/inngest/registry-golden.test.ts:28-78`,
  `src/server/observability/sdk/flush.ts:16-24`, `src/app/api/inngest/route.ts:13-17` (target route
  shape), `.claude/rules/server-architecture.md`, `.claude/rules/bedrock-invocation.md`
