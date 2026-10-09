---
paths:
  - "src/server/**"
  - "src/app/api/**"
  - "src/domain/**"
  - "src/instrumentation.ts"
  - "drizzle.config.ts"
---

# Server architecture (adr004 / adr005 / adr002)

[adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md)
is executed as a **class-based** controller / service / repository 3-tier, one
domain per change (strangler). Reference implementations: `src/server/outbox/`
(cron workers + the write door), `src/server/receipts/` (one domain, two
services: `receipts.*` is the member-facing `ReceiptsService` over tRPC, HTTP and
email; `receipt-extraction.*` is the event worker + external adapters),
`src/server/email/email.*` (HTTP webhook
controller behind `src/app/api/receipts/inbound/route.ts`),
`src/server/transactions/` (the reference tRPC domain) and `src/server/categories/`
(a top-level domain other domains link to by id).
Existing plain tRPC routers stay as they are until their domain is migrated in
its own change — never refactor a router toward 3-tier inside a feature diff.

## Tier map — one class per file, file named for its tier

| File                                | Tier         | Owns                                                                                                                                                                | Depends on                         |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `<domain>.<transport>.controller.ts` | presentation | Transport is `inngest`, `http` or `trpc` (`outbox.inngest.controller.ts`, `email.http.controller.ts`, `transactions.trpc.controller.ts`). Inngest `createFunction` declarations (id, triggers, retries, concurrency), an HTTP controller with one `(request: Request) => Promise<Response>` method per route (`handle` for one route; `image` / `upload` when one controller serves several, as `receipts.http.controller.ts` does), or a tRPC router object whose procedures do `.input()` + procedure auth + one `ctx.services.<svc>.<method>()` call, with no Drizzle and no try/catch. A procedure may call any domain's service. Filters, auth checks, then calls **one** service method. No rules. | the service class (tRPC: `ctx.services`); `logger: Logger` |
| `<domain>.service.ts`               | application  | Business rules. Small public methods, one job each; private helpers for the steps. Domain constants, size caps, member-facing error copy live here.                  | `repository` + adapter interfaces; `logger: Logger` |
| `<domain>.repository.ts`            | data         | Drizzle only. Intent-named methods (`findUnsent`, `markDuplicate`, `saveExtraction`) with the status transition inside. Throws; no logging, no try/catch.           | `db`                               |
| `<domain>.<adapter>.ts`             | adapter      | One external system behind an interface — `email.mailbox.ts` (Resend reads). Interface + impl in the same file. A provider adapter shared across domains lives in its own top-level infra folder instead (`src/server/blob-store/` for Vercel Blob, `src/server/aws/`), not under a domain. The AI model is not an adapter file: `ReceiptExtractionService` takes the AI SDK `LanguageModel` as its `languageModel` dep and calls `generateObject` itself (see `bedrock-invocation.md`). | the SDK it wraps                   |
| `<domain>.module.ts`                | composition  | Optional. Add only when a **second** consumer needs the same service instance; until then the composition root does the `new` calls. Each exports one instance: `outbox.module.ts`, `categories.module.ts`, `expenses.module.ts`, `transactions.module.ts`, `receipts.module.ts`, `auth/members.module.ts`, `allowed-senders/allowed-senders.module.ts`. | —                                  |
| `src/server/observability/`         | shared adapter | Shared observability provider, split OTel API vs SDK. API side (tiers may import): `logging/` (`Logger` port + `OtelLogger`), `tracing/` (`withSpan`, baggage, trace id, trace carrier), `errors/` (`captureException`, `reportError`, thrown-value helpers). SDK side: `sdk/` (boot `otel.ts`, sampler, `SpanAttributeProcessor`, prompt redaction, flush) — imported only by `instrumentation.ts`, route roots (`withFlush`) and test harnesses, never a tier. Framework adapters live with their consumer (`TracingMiddleware` in `src/server/inngest/middleware.ts`). Like `blob-store/` — lives outside any domain. | OTel SDK + PostHog SDKs            |

A domain with no tables, such as `cashflow/`, has no repository: its service
depends only on other services' ports.

Unchanged homes: `*.schema.ts` (adr005), `*.dto.ts`, `*.errors.ts`, `*.decide.ts` (earned only).

A domain's child is one of two kinds
([adr023](../../docs/adr/adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md)).
No middle kind: never prefixed child files in another domain's folder.

| Kind           | Test                                                                                              | Home                                                             | Example                                  |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Part of parent | All three: made and deleted with the parent row; no other domain links to it by id; no page or router of its own. | The parent's files.                                              | `receipt_item` in `receipts.schema.ts`   |
| Own domain     | Any part-of-parent check fails.                                                                   | Top-level `src/server/<name>/`, named like `src/domain/<name>/`. | `categories/` ↔ `src/domain/categories/` |

Folders stay flat. A child becomes its own domain only once every link to it is
an id.

## Construction rules

- **Classes, built with `new X({ … })`.** One `interface XDeps` directly above the
  class; the constructor takes exactly that object. Explicit `private readonly`
  fields assigned in the constructor. No TS parameter properties, no decorators,
  no DI container.
- **Interface for ports, class for the tier above.** Repository and adapters export
  `interface Foo` + `class DrizzleFoo` / `VercelFoo` / `ModelFoo`. The service types
  its deps as the interfaces; the controller types `service` as the class. A test
  fake is then a plain object literal with no cast.
- **Deps are objects, not functions.** Deps are objects with methods
  (`blobStore.read`, `mailbox.download`), never bare `fn` fields. No `make*()`
  factories that build a tier from closures — use a class. A provider SDK object
  (`languageModel: LanguageModel`) counts as an object dep; bind it in the
  composition root only.
- **`with*()` wrappers are allowed.** A stateless wrapper that takes a function and
  runs or wraps it, unchanged in signature (`withSpan`, `withFlush`, `withRetry`), adds
  cross-cutting behavior around a call; it is not a dep. Keep it generic and
  domain-free, and put it in a shared module (`observability/`, `lib/`).
- **Composition roots.** `src/server/api/services.ts` is the tRPC root: it builds
  each service once at module load, and `createTRPCContext` (`src/server/api/context.ts`)
  attaches them as `ctx.services`. No service may throw on a missing env var, because
  the build loads that file. Services hold no per-request state: session values go in
  as `memberId` arguments, and only to methods that read them. A `*.module.ts` exists
  only when two or more composition roots (or another module) need the same instance;
  `services.ts` imports those shared instances instead of building them.
- **Worker root is `src/server/inngest/functions.ts`.** Real
  `db`, `inngest`, and provider SDKs (Bedrock via `~/env`) are touched only there —
  see `bedrock-invocation.md`. A controller exposes `get functions()`; the root
  spreads them into the array served by `src/app/api/inngest/route.ts`.
- **An HTTP route file is its own composition root.** `route.ts` reads the env
  (500 when unset), builds the tiers lazily on first request in a `compose()`
  memo, and each route method (`GET` / `POST`) returns one controller call
  (`controller.handle(request)`). The controller uses plain
  `Request` / `Response`, never `NextResponse`, so it tests without Next.
- **Handlers close over `this.service` lazily**, so the golden test can build a
  controller with `service: {} as never`.
- **Retry contract.** Inngest passes `attempt`; the controller maps it to
  `isFinalAttempt: attempt >= RETRIES`. The service rethrows a retryable error
  while attempts remain and parks the row (`markFailed`) on the final or a
  deterministic one. `RETRIES` lives in the controller.
- **Error capture choke points only.** Services and repositories never call
  `captureException`. Exceptions are captured only at the four choke points:
  `onRequestError` (`src/instrumentation.ts`), the tRPC `observabilityMiddleware`,
  the tRPC route's `onError` (pre-procedure 5xx failures only — context build,
  request read — which never reach the middleware), and the Inngest `TracingMiddleware.onRunError`. Exception: `ReceiptExtractionService` calls
  `captureException` on the park path because `onRunError` only fires on throws —
  parked terminal failures never throw, so the domain tier owns that capture.
  Tiers log through their injected `logger.error`; spans `recordException`.
- **Inngest handlers read named fields, never spread `event.data`.** Pick
  `event.data.receiptId` etc. by name — `event.data` carries the adr016 `_trace`
  pocket and must not be spread or hashed into a new object.

## Errors

- Services throw `NotFoundError` / `ConflictError` (`src/server/errors/`), never
  `TRPCError`. Nothing under `src/server/errors/` imports tRPC.
- A service turns a pg violation into `ConflictError` with `isPgViolation` /
  `rethrowFkConflict`. A missing row is `NotFoundError`; `assertRow` throws a plain
  `Error`, which stays `INTERNAL_SERVER_ERROR`.
- Repositories let driver errors bubble.
- The tRPC error-mapping middleware (`src/server/api/trpc.ts`) owns the code:
  `NotFoundError` → `NOT_FOUND`, `ConflictError` → `CONFLICT`, message and cause kept.
  Anything else passes through unchanged.

## Service split rule

One service per domain. Add a second only when:

- its methods use **disjoint dependency sets**, or
- a different caller or actor needs dependencies the others never use.

Split on real pain, not in advance.

## Tests (colocated, see unit-testing rule)

- `*.repository.test.ts` — never hit Postgres. A tRPC domain uses `recordingDb()`
  (`src/server/db/recording-db.fake.ts`): it renders every query through the real
  `PgDialect` and records `{ sql, params, method }`, so the router's
  characterization snapshots carry over unchanged. It supports
  `db.transaction(cb)` and records `begin` / `commit` / `rollback`.
  `src/server/transactions/transactions.repository.test.ts` is the example, and
  `ReceiptsRepository` uses it too. The worker domains (`outbox`, receipt
  extraction) use a hand-rolled chain-capturing fake `db` instead:
  render a WHERE with `new PgDialect().sqlToQuery(cond).sql`, assert on the
  text, and assert `set()` payloads.
- `*.service.test.ts` — fake repository + adapters as object literals typed
  against the interfaces, recording calls in arrays. No module mocking. Fake
  `logger: Logger` (object literal recording `{ level, msg, attrs }`) asserts
  log calls — never spy `console.error`.
- `*.controller.test.ts` — spy `createFunction` captures `{ opts, handler }`;
  assert the frozen opts and that each handler routes to the right service method
  with the right args. For an HTTP controller: fake verifier + fake service, call
  each route method (`handle(new Request(…))`), assert status + body per gate.
- `*.trpc.controller.test.ts` — `createTestCaller` (`src/server/api/test-caller.ts`)
  with `Partial<XService>` fakes. No `vi.mock`, no `ctx.db`. Assert each procedure
  calls its method with the parsed input, and that a thrown domain error maps to its
  tRPC code through the real middleware.
- `src/server/architecture.test.ts` — enforces the adr022 import rules. Its `TODO`
  list of known violations only shrinks: delete an entry when its migration lands.
- `route.test.ts` — mock the tier modules; assert only the root's job (env gate,
  built once, delegates to its controller method).
- `src/server/inngest/registry-golden.test.ts` builds every controller with the spy
  client and pins ids + triggers.

## tRPC routers (not yet migrated)

- One plain `createTRPCRouter({ … })` per file in `src/server/api/routers/<name>.ts`;
  procedures talk to Drizzle directly via `ctx.db`.
- Compose the pre-built router objects in `src/server/api/root.ts`
  (`allowedSender` comes from `src/server/allowed-senders/`,
  `balance` from `src/server/balances/`, `cashflow` from
  `src/server/cashflow/`, `category` from `src/server/categories/`, `expense`
  from `src/server/expenses/`, `income` from `src/server/income/`, `receipt`
  from `src/server/receipts/`, `setting` from `src/server/settings/`, and
  `transaction` from `src/server/transactions/`).
- Errors are thrown inline as `TRPCError`, or through the shared helpers in
  `src/server/errors/`, which throw the non-tRPC errors described under
  [Errors](#errors): `parseError(error)` (normalises a driver error into a
  tagged union — branch on `kind === "pg"` + a named `PgViolation`, never a bare
  SQLSTATE; `parse-error.ts`), `assertRow(row, "op")` (`.returning()` presence,
  `assert-row.ts`) and `rethrowFkConflict(error, message)` (`fk-conflict.ts`).
  Step 8 rewrites this section.
- When a router domain migrates, the router becomes the controller tier over a
  `<domain>.service.ts`; same construction rules apply.

## Schema homes (adr005 / adr022)

Drizzle tables live per-domain in `src/server/<domain>/<domain>.schema.ts` — e.g.
`expenses/expenses.schema.ts`, `categories/categories.schema.ts`,
`balances/balances.schema.ts`, `auth/auth.schema.ts`. drizzle-kit globs
`src/server/**/*.schema.ts`.

Each domain owns its tables ([adr022](../../docs/adr/adr022-cross-domain-data-through-the-owning-service.md)):

- A repository touches only its own domain's tables.
- Cross-domain reads **and** writes go through the owning service, typed as a
  narrow `Pick` or port (`OutboxWriteDoor`), so a test fake is an object literal.
- A join becomes a batched lookup: `TransactionsService.list` makes one
  `ExpensesService.namesByIds` and one `CategoriesService.namesByIds` call per
  page, Categories after Expenses (a linked row's Category comes from its
  Expense, adr025), merges in memory, and gives a null name for a missing id.
- Schema files may import each other for foreign keys only.
- `src/server/architecture.test.ts` enforces this. Its `TODO` list of known
  violations only shrinks: each migration step deletes its entries.

## Domain kernel (`src/domain/`)

Isomorphic-by-need: what client code shares, plus each domain's DTO ↔ interface
contracts even when only the server reads them (`receipt-extraction.dto.ts`, the
inbound email webhook body in `email.dto.ts`) — one home per contract. Each domain
folder holds `<domain>.dto.ts` (Zod), `<domain>.interface.ts` (TS types), an
`index.ts` barrel, and occasionally pure compute (`cashflow/cashflow.ts`). Nothing
here imports `src/server/**`.

## Writes

Multi-statement writes that must be atomic use the postgres-js interactive
transaction — `db.transaction(async (tx) => { … })` (adr002/adr003). In a
repository that is `this.db.transaction(...)` (`saveExtraction`,
`CategoriesRepository.reorder`).

## Outbox + Inngest (adr002)

- `src/server/inngest/events.ts` `EVENT_REGISTRY` is the single event-name +
  payload authority (`EventName`, `EventPayload<K>`, `OutboxEventDescriptor`);
  `buildOutboxEvent(name, payload)` mints a registry-validated descriptor — every
  send goes through it. The client (`client.ts`) is
  `new Inngest({ id, eventKey, logger, middleware: [TracingMiddleware] })` with no
  `schemas`: inngest v4 dropped the typed `schemas` option, so safety lives at the
  mint boundary, not the client type.
- `src/server/outbox/` is the write door. A migrated repository injects
  `outboxService` typed as `OutboxWriteDoor` and calls `commit(writes, events)`
  (or `publish` for emit-only): `OutboxRepository.commit` runs the canonical rows
  + outbox rows in one `db.transaction()`, `OutboxService.commit` then does the
  best-effort post-commit send. `OutboxInngestController` declares `outbox-sweep`
  (re-delivers unacked rows, the durable backstop) and `outbox-prune` (drops acked
  rows past retention) over the same service. Never a bare `inngest.send` from a
  handler.

## FROZEN external identifiers

`EVENT_REGISTRY` keys, the Inngest app id (the `package.json` `name`, via
`env.PROJECT_NAME`), Inngest function ids (`outbox-sweep`, `outbox-prune`,
`process-receipt`), their crons / event triggers, and concurrency keys are
byte-stable wire strings: Inngest keys schedules and runs by them.
`src/server/inngest/registry-golden.test.ts` pins them. Changing one requires
updating the golden test **deliberately** and recording the rename in an ADR
consequence note — never a drive-by.
