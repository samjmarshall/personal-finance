# Server architecture (adr004 / adr005 / adr002)

[adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md)
is executed as a **class-based** controller / service / repository 3-tier, one
domain per change (strangler). Reference implementations: `src/server/outbox/`
(cron workers + the write door), `src/server/receipts/receipts.*` (event worker +
external adapters) and `src/server/email/email.*` (HTTP webhook
controller behind `src/app/api/receipts/inbound/route.ts`).
Existing plain tRPC routers stay as they are until their domain is migrated in
its own change — never refactor a router toward 3-tier inside a feature diff.

## Tier map — one class per file, file named for its tier

| File                                | Tier         | Owns                                                                                                                                                                | Depends on                         |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `<domain>.controller.ts`            | presentation | Inngest `createFunction` declarations (id, triggers, retries, concurrency) or an HTTP `handle(request: Request): Promise<Response>`. Filters, auth checks, then calls **one** service method. No rules. | the service class; `logger: Logger` |
| `<domain>.service.ts`               | application  | Business rules. Small public methods, one job each; private helpers for the steps. Domain constants, size caps, member-facing error copy live here.                  | `repository` + adapter interfaces; `logger: Logger` |
| `<domain>.repository.ts`            | data         | Drizzle only. Intent-named methods (`findUnsent`, `markDuplicate`, `saveExtraction`) with the status transition inside. Throws; no logging, no try/catch.           | `db`                               |
| `<domain>.<adapter>.ts`             | adapter      | One external system behind an interface — `email.mailbox.ts` (Resend reads). Interface + impl in the same file. A provider adapter shared across domains lives in its own top-level infra folder instead (`src/server/blob-store/` for Vercel Blob, `src/server/aws/`), not under a domain. The AI model is not an adapter file: `ReceiptsService` takes the AI SDK `LanguageModel` as its `languageModel` dep and calls `generateObject` itself (see `bedrock-invocation.md`). | the SDK it wraps                   |
| `<domain>.module.ts`                | composition  | Optional. Add only when a **second** consumer needs the same service instance; until then the composition root does the `new` calls. `outbox.module.ts` exports `outboxService`. | —                                  |
| `src/server/observability/`         | shared adapter | Shared observability provider: `Logger` port + `OtelLogger` impl, OTel boot (`otel.ts`), flush (`flush.ts`), PostHog capture (`posthog.ts`), trace carrier (`trace-carrier.ts`), baggage (`baggage.ts`), `ContextSpanProcessor`, `TracingMiddleware`. Like `blob-store/` — lives outside any domain. Tiers see only `Logger` + the ambient OTel API (`@opentelemetry/api`). | OTel SDK + PostHog SDKs            |

Unchanged homes: `*.schema.ts` (adr005), `*.dto.ts`, `*.errors.ts`, `*.decide.ts` (earned only).

## Construction rules

- **Classes, built with `new X({ … })`.** One `interface XDeps` directly above the
  class; the constructor takes exactly that object. Explicit `private readonly`
  fields assigned in the constructor. No TS parameter properties, no decorators,
  no DI container.
- **Interface for ports, class for the tier above.** Repository and adapters export
  `interface Foo` + `class DrizzleFoo` / `VercelFoo` / `ModelFoo`. The service types
  its deps as the interfaces; the controller types `service` as the class. A test
  fake is then a plain object literal with no cast.
- **No functions that take functions.** Deps are objects with methods
  (`blobStore.read`, `mailbox.download`), never bare `fn` fields. No `make*()`
  factories that return closures. A provider SDK object (`languageModel:
  LanguageModel`) counts as an object dep; bind it in the composition root only.
- **Composition root is `src/server/inngest/functions.ts`** for workers. Real
  `db`, `inngest`, and provider SDKs (Bedrock via `~/env`) are touched only there —
  see `bedrock-invocation.md`. A controller exposes `get functions()`; the root
  spreads them into the array served by `src/app/api/inngest/route.ts`.
- **An HTTP route file is its own composition root.** `route.ts` reads the env
  (500 when unset), builds the tiers lazily on first request in a `compose()`
  memo, and `POST` returns `controller.handle(request)`. The controller uses plain
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
  the tRPC route's `onError` (context-build failures only, which never reach the
  middleware), and the Inngest `TracingMiddleware.onRunError`. Exception: `ReceiptsService` calls
  `captureException` on the park path because `onRunError` only fires on throws —
  parked terminal failures never throw, so the domain tier owns that capture.
  Tiers log through their injected `logger.error`; spans `recordException`.
- **Inngest handlers read named fields, never spread `event.data`.** Pick
  `event.data.receiptId` etc. by name — `event.data` carries the adr016 `_trace`
  pocket and must not be spread or hashed into a new object.

## Tests (colocated, see unit-testing rule)

- `*.repository.test.ts` — hand-rolled chain-capturing fake `db`; render a WHERE
  with `new PgDialect().sqlToQuery(cond).sql` and assert on the text; assert `set()`
  payloads. Never hit Postgres.
- `*.service.test.ts` — fake repository + adapters as object literals typed
  against the interfaces, recording calls in arrays. No module mocking. Fake
  `logger: Logger` (object literal recording `{ level, msg, attrs }`) asserts
  log calls — never spy `console.error`.
- `*.controller.test.ts` — spy `createFunction` captures `{ opts, handler }`;
  assert the frozen opts and that each handler routes to the right service method
  with the right args. For an HTTP controller: fake verifier + fake service, call
  `handle(new Request(…))`, assert status + body per gate.
- `route.test.ts` — mock the tier modules; assert only the root's job (env gate,
  built once, delegates to `handle`).
- `src/server/inngest/registry-golden.test.ts` builds every controller with the spy
  client and pins ids + triggers.

## tRPC routers (not yet migrated)

- One plain `createTRPCRouter({ … })` per file in `src/server/api/routers/<name>.ts`;
  procedures talk to Drizzle directly via `ctx.db`.
- Compose the pre-built router objects in `src/server/api/root.ts`
  (`balance, cashflow, category, expense, income, setting, transaction`).
- Errors are thrown inline as `TRPCError`. Two shared helpers, not an error tier:
  `parseError(error)` (normalises a driver error into a tagged union — branch on
  `kind === "pg"` + a named `PgViolation`, never a bare SQLSTATE;
  `src/server/api/lib/parse-error.ts`) and `assertRow(row, "op")` (`.returning()`
  presence, `src/server/api/lib/assert-row.ts`).
- When a router domain migrates, the router becomes the controller tier over a
  `<domain>.service.ts`; same construction rules apply.

## Schema homes (adr005)

Drizzle tables live per-domain in `src/server/<domain>/<domain>.schema.ts` — e.g.
`expenses/expenses.schema.ts`, `expenses/categories.schema.ts`,
`balances/balances.schema.ts`, `auth/auth.schema.ts`. drizzle-kit globs
`src/server/**/*.schema.ts`. Importing a sibling domain's tables for **read**
joins is fine (`category.ts` joining `expenses`; the receipts repository reading
`expenseCategories`); there is no cross-domain write ceremony — writes are direct
db calls too.

## Domain kernel (`src/domain/`)

Isomorphic-by-need: only what client code shares. Each domain folder holds
`<domain>.dto.ts` (Zod, client + server), `<domain>.interface.ts` (TS types), an
`index.ts` barrel, and occasionally pure compute (`cashflow/cashflow.ts`).

## Writes

Multi-statement writes that must be atomic use the postgres-js interactive
transaction — `db.transaction(async (tx) => { … })` (adr002/adr003). In a
repository that is `this.db.transaction(...)` (`saveExtraction`); in a router it is
`ctx.db.transaction(...)` (`category.ts` `update`, `reorder`).

## Outbox + Inngest (adr002)

- `src/server/inngest/events.ts` `EVENT_REGISTRY` is the single event-name +
  payload authority (`EventName`, `EventPayload<K>`, `OutboxEventDescriptor`);
  `buildOutboxEvent(name, payload)` mints a registry-validated descriptor — every
  send goes through it. The client (`client.ts`) is a bare
  `new Inngest({ id, eventKey })`: inngest v4 dropped the typed `schemas` option,
  so safety lives at the mint boundary, not the client type.
- `src/server/outbox/` is the write door. A migrated repository injects
  `outboxService` typed as `OutboxWriteDoor` and calls `commit(writes, events)`
  (or `publish` for emit-only): `OutboxRepository.commit` runs the canonical rows
  + outbox rows in one `db.transaction()`, `OutboxService.commit` then does the
  best-effort post-commit send. Unmigrated routers use the bound `commitWithOutbox`
  export from `~/server/outbox`. `OutboxController` declares `outbox-sweep`
  (re-delivers unacked rows, the durable backstop) and `outbox-prune` (drops acked
  rows past retention) over the same service. Never a bare `inngest.send` from a
  handler.

## FROZEN external identifiers

`EVENT_REGISTRY` keys, Inngest function ids (`outbox-sweep`, `outbox-prune`,
`process-receipt`), their crons / event triggers, and concurrency keys are
byte-stable wire strings: Inngest keys schedules and runs by them.
`src/server/inngest/registry-golden.test.ts` pins them. Changing one requires
updating the golden test **deliberately** and recording the rename in an ADR
consequence note — never a drive-by.
