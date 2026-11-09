# Nest patterns without Nest

Date: 2026-11-09
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr004 (3-tier), adr002 (outbox), adr015 (telemetry flush), adr017 (CDR sync), adr022 (cross-domain data)

## Problem

`src/server/` is a home-made 3-tier: controller, service and repository classes built with
`new X({ … })`, wired by hand. The question was how much of NestJS could replace it, and what we
would still own.

Answer: no Nest package fits, but five Nest ideas do. We copy the useful ones into our own
code.

Real duplication found today:

- Errors map to transport codes in two places, and HTTP never maps `ConflictError`.
- Three receipts routes each build the same `ReceiptsHttpController`.
- `DrizzleCdrRepository` is built twice, and roots repeat 12 `createRootLogger()` / repository
  builds.
- Env reads are spread across roots and modules.
- The image, html, health and auth routes skip `withFlush`, so their telemetry can be lost.

## Why no Nest packages

- Every `@nestjs/*` package needs the Nest container. None is a drop-in.
- Guards, pipes and interceptors run only when Nest owns the request. Next owns it here.
  `createApplicationContext` gives DI only.
- `nestjs-trpc` and the Inngest–Nest libraries need Nest's HTTP layer.
- TS 7 is not the blocker. tsgo supports `experimentalDecorators` + `emitDecoratorMetadata`
  (typescript-go #2343), and Next (SWC) and Vitest (Oxc) emit the metadata. The real blockers:
  - TS 7.0 has no compiler API, so `nest build`, the swagger CLI plugin and ts-jest break.
  - Biome's `useImportType` safe fix turns DI imports into `import type`, which silently emits
    `Object` metadata. tsgo doesn't catch it.
  - Decorators need Biome's `javascript.parser.unsafeParameterDecoratorsEnabled`.
- Nest 12 still uses legacy decorators, with no TC39 plan (nestjs#11414).

adr004 stands: classes, `new X({ … })`, explicit `private readonly` fields, no container, no
decorators.

## What we copy

| Nest idea | Ours | When |
|---|---|---|
| Exception filter | `DomainError` + `kind`, one complete map per transport | now |
| Interceptor | `withFlush` on every route, checked by a test | now |
| Module | one lazy module per domain, plus a worker module where needed | now |
| Guard | session check stays in the controller | later |
| Pipe | tRPC `.input(zod)` already does it | dropped |

tRPC already has all four: `protectedProcedure` (guard), `.input()` (pipe),
`observabilityMiddleware` (interceptor), `errorMappingMiddleware` (filter). Only plain HTTP routes
lack them.

## Industry check

Four research passes (Spring Modulith, NestJS + Clean Architecture repos, .NET Clean
Architecture + Milan Jovanovic's modular monolith, Pure DI per Seemann and Stemmler) agree:

1. One module per domain. Not per entity, not per layer.
2. Worker-only code gets its own module or root.
3. A module's exports are its public API, enforced by a test.
4. Config fails fast, plus a test that builds every module.

| | Spring | NestJS / Clean Arch | .NET (Milan) | Pure DI |
|---|---|---|---|---|
| Module size | 1 per business area | 1 per domain, small | 1 per capability | 1 per feature folder |
| Worker code | own module or entry point | own headless app (Gauzy) | outbox + background worker | own module, worker root only |
| Public API | top package | module `exports` | Contracts project, rest `internal` | folder `index.ts` |
| Enforced by | `verify()` | dependency-cruiser | NetArchTest | Sheriff / eslint-plugin-boundaries |
| Cross-module | events first | exported service; DDH prefers events | sync interface + async events via outbox | — |
| Config | per module + build-all test | `validate`, fail fast | `ValidateOnStart` | read env in the lazy factory |
| Tests | fake other modules | `overrideProvider` | system tests | each test is its own root |

Skipped:

- Per-layer wiring (Jason Taylor). We group by domain already.
- Mediator/CQRS libraries. MediatR 13+ is commercial, Milan warns its in-process publish blocks
  the sender, and Nest calls CQRS overkill for CRUD.
- Seemann's "one root per process". Each Next route file is its own entry point, so each is its
  own root, and module files are pieces of that root.

We already match: outbox + Inngest events (Milan's pattern), no cross-domain joins (adr022), and
`architecture.test.ts` (the `verify()` / NetArchTest role).

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | Copy Nest's patterns; use no Nest package. | Nest packages behind wrappers. Full Nest beside Next. |
| 2 | Build the filter, interceptor and module now. Defer the guard; drop the pipe. | The full filter/guard/interceptor pipeline now. |
| 3 | `DomainError` with `kind`; a complete `Record<DomainErrorKind, …>` per transport. | `instanceof` chains per transport. One shared map that knows about tRPC. |
| 4 | `UnauthorizedError` (kind `unauthorized`) replaces `UploadUnauthorizedError`. | Keeping a receipts-only error. |
| 5 | Every route method is wrapped in `withFlush`. No exemptions. | Per-route exemptions. |
| 6 | One `<domain>.module.ts` per domain, plus `<domain>.worker.module.ts` only for worker-only deps. | Strictly one per domain (AWS SDK in web bundles). One per service (~20 files). |
| 7 | One `src/env.ts`; modules read it inside `once()`; module factories never throw. | Per-module Zod env schemas. Roots passing config in. |
| 8 | A controller lives in the module of the service it calls. | Roots building controllers. A per-route controller factory. |
| 9 | Sync calls via `Pick<OtherService, …>`; async via outbox events. Contracts split into data, methods and events. | A `<domain>.contracts.ts` per domain. Events first. |
| 10 | Extend `architecture.test.ts`; turn on Biome `noImportCycles`. | dependency-cruiser. eslint-plugin-boundaries / Sheriff (need ESLint). |
| 11 | Unit tests unchanged, plus one smoke test that builds every module. | An `overrides` argument on every module. No smoke test. |
| 12 | Roll out in 3 tracks of small PRs with a shrink-only `TODO`. | One big PR. Migrating only when feature work touches a domain. |

## Errors (the filter)

`src/server/errors/domain-errors.ts`:

- `abstract class DomainError extends Error` with `abstract readonly kind: DomainErrorKind`.
- `DomainErrorKind = "not_found" | "conflict" | "invalid_input" | "unauthorized"`.
- `NotFoundError`, `ConflictError`, `InvalidInputError` and the new `UnauthorizedError` extend it.
  Constructors stay `(message, { cause })`, so the 30 throw sites don't change.
- `UnauthorizedError` replaces `UploadUnauthorizedError` (`receipts.service.ts:50`).

One map per transport:

| Transport | Map | Lives in |
|---|---|---|
| tRPC | `Record<DomainErrorKind, TRPC_ERROR_CODE_KEY>` | `src/server/api/trpc.ts` |
| HTTP | `Record<DomainErrorKind, number>` + `httpStatusFor(error)` | `src/server/errors/http-status.ts` |

- tRPC: `errorMappingMiddleware` drops its `instanceof` chain. A `DomainError` maps through
  `mappedError(TRPC_CODE[error.kind], error)`, keeping the stack. It still remaps only
  `INTERNAL_SERVER_ERROR`.
- HTTP: status only; bodies stay per route.
  - Upload: `failureStatus = httpStatusFor(error) ?? (completed ? 400 : 500)`.
  - Image/html: `httpStatusFor(error) === 404` returns their plain-text 404.
- Adding a kind fails the typecheck until both maps cover it.
- HTTP now maps `ConflictError` to 409.
- `errors/` never imports tRPC.

Not domain errors, left as they are: `ReceiptTooLargeError`, `RedisUnavailableError`,
`RedbarkRetryableError`, `CdrSyncError`. They are internal retry or flow signals, not caller
answers.

## Interceptor and guard

Rule 7: every HTTP method exported from `src/app/api/**/route.ts` is
`export const <METHOD> = withFlush(…)`. The test fails on `export async function GET`, on a
destructured export, and on any `export const <METHOD> =` not followed by `withFlush(`.

| Route | Today | Change |
|---|---|---|
| `receipts/[id]/image` | `export async function GET` | `export const GET = withFlush(…)` |
| `receipts/[id]/html` | same | same |
| `health` | same | same; `connection()` + `select 1` stay inside |
| `auth/[...all]` | `export const { GET, POST } = toNextJsHandler(…)` | `const handlers = toNextJsHandler(…)`, wrap each, as `inngest/route.ts` does |

Guard: the session check stays in `ReceiptsHttpController.signedIn()`, shared by its 3 routes.
tRPC has `protectedProcedure`.

Pipe: tRPC validates with `.input(zod)`. The two HTTP bodies validate in their controllers
(`isUploadBody`, `inboundEmailEventDto.safeParse`) with different failure replies: upload answers
400, email answers 200 "ignored" so Svix won't retry. A shared pipe would branch on that.

## Modules

`src/lib/once.ts`: `once<T>(build: () => T): () => T` builds on the first call and caches.

Shape (`receipts.module.ts`):

```ts
export const receiptsModule = once(() => {
	const service = new ReceiptsService({
		repository: new DrizzleReceiptsRepository({ db, outbox: outboxModule().service }),
		members: membersModule().service,
		// …
	});

	return {
		service,
		http: new ReceiptsHttpController({
			service,
			sessions: membersModule().sessions,
			logger: createRootLogger().with({ domain: "receipts", component: "http" }),
		}),
	};
});
```

- The returned object is the public API. Repositories and adapters are built inside, never
  returned.
- Export keys: `service` (main service); other services by name (`duplicateApply`,
  `reconcile`); `http` (HTTP controller); `functions` (Inngest functions).
- The module builds its loggers as `{ domain, component: <tier> }`. The 3 receipts routes now share
  `component: "http"`; span names and Next's route span tell them apart.

| Module | Exports |
|---|---|
| outbox | `service`, `functions` |
| categories, allowed-senders, balances, expenses, settings, income, cashflow, cdr | `service` |
| members (`auth/`) | `service`, `sessions` (`BetterAuthSessionReader`) |
| transactions (folds in duplicate-apply) | `service`, `duplicateApply`, `functions` |
| transactions.worker | `reconcile` (Bedrock embeddings) |
| receipts | `service`, `http` |
| receipts.worker | `functions` (Bedrock LLM) |
| cdr.worker | `functions` (Redbark + `transactionsWorkerModule().reconcile`) |
| email | `http`, or `null` when the Resend keys are unset |

A worker module holds deps only the Inngest worker needs. Static imports would otherwise pull the
AWS SDK into the tRPC and route bundles. Inngest controllers sit with the service they call:
outbox and transactions in the normal module, receipts and cdr in the worker module.

Roots:

- `services.ts`: `services = once(() => ({ receipts: receiptsModule().service, … }))`,
  `Services = ReturnType<typeof services>`. `createTRPCContext` calls `services()`.
- `functions.ts`: `[...outboxModule().functions, ...transactionsModule().functions,
  ...receiptsWorkerModule().functions, ...cdrWorkerModule().functions]`. It runs at import because
  `serve()` needs the array; that is safe because module factories never throw.
- `route.ts`: `export const POST = withFlush((r: Request) => receiptsModule().http.upload(r))`.
  The lazy `compose()` memos go. Inbound email returns 500 when `emailModule().http` is `null`.

Not modules: `db`, the `inngest` client, the better-auth instance and the logger factory. They
belong to no domain.

## Config

- One `src/env.ts` (t3-env + Zod), validated when `next.config.ts` loads. A bad env stops
  startup.
- Modules read `env` inside `once()`, never at import.
- Module factories never throw. This replaces the "no service may throw on a missing env var"
  note in `services.ts`, and keeps the eager Inngest root safe at build.
- Services, repositories and controllers never import `~/env` (rule 8). Values arrive through
  deps: `uploadPathPrefix`, `posthogUi`, `languageModel`.
- A missing optional integration yields a null value; the caller decides:

| Integration | Unset gives | Caller does |
|---|---|---|
| Redbark | `redbark: null` | daily sync is a logged no-op (adr017) |
| Resend | `emailModule().http === null` | route returns 500 |

## Calls between modules

- Sync, when the caller needs the answer now: type the dep as `Pick<OtherService, "a" | "b">`,
  a narrow interface the caller owns. `import type` from another domain's `*.service.ts` is
  allowed.
- Async, when the work is slow, may fail, or says "this happened": an outbox event committed in
  the same transaction as the write (adr002).
- Never reach another domain's repository, schema or tables (adr022, rules 1 and 11). No event
  bus, no mediator, no import cycles.

Contracts have three parts, all in place today:

| Part | Home |
|---|---|
| Data | `src/domain/<domain>/`: DTOs, types, pure rules |
| Methods | `Pick<…>` in the caller's deps |
| Events | `EVENT_REGISTRY` in `inngest/events.ts`, central because the names are FROZEN |

Service size: one service per domain. Split one off only when the new part needs different deps
or runs elsewhere (the worker). No use-case classes up front.

## Enforcement

`architecture.test.ts`:

| # | Rule | Change |
|---|---|---|
| 1, 3, 4, 6 | as today | none |
| 2 | another domain's repository | folded into 11 |
| 5 | only roots import a module | roots = `services.ts`, `functions.ts`, `route.ts`, `*.module.ts` |
| 7 | route method not wrapped in `withFlush` | new |
| 8 | a service, repository or controller imports `~/env` | new |
| 9 | `*.worker.module.ts` imported by anything but `functions.ts` or another worker module | new |
| 10 | `~/server/aws/` imported outside `*.worker.module.ts` | new; replaces the bedrock-invocation rule |
| 11 | crossing into another domain other than its `*.module.ts` or `import type` from its `*.service.ts` | new |
| — | import cycles | Biome `suspicious/noImportCycles` (skips `import type` by default) |

A domain is any `src/server/<x>/` folder holding a `*.module.ts`.

Rule 11 exceptions:

- `*.schema.ts` → `*.schema.ts` for foreign keys, and `db/index.ts` merging schemas (adr022).
- `api/root.ts` → `*.trpc.controller.ts`, which mounts the tRPC routers.
- The better-auth instance (`~/server/auth`, `~/server/auth/server`) is shared infra, like `db`.
- `BetterAuthSessionReader` moves behind `membersModule().sessions`.

## Testing

- Unit tests don't change: `new X({ …fakes })`, object-literal fakes, no module mocking.
- No `overrides` argument on module factories. Nest needs `overrideProvider` because its container
  builds the graph; our tests already build with `new`.
- New `src/server/modules.smoke.test.ts`:
  - calls every module factory, plus `services()` and `functions`
  - asserts each builds without throwing and returns the expected keys
  - asserts the `functions` ids match `registry-golden.test.ts`
  - never queries; postgres-js connects on the first query
- `route.test.ts` mocks the module (`receiptsModule: () => ({ http: fake })`), not the tier
  classes.
- No `once()` reset helper. Vitest isolates each test file.

## Rollout

| Track | PRs |
|---|---|
| 1. Errors | 1: `DomainError` + `kind`, both maps, `UnauthorizedError` |
| 2. Interceptor | 1: rule 7, wrap image, html, health and auth |
| 3. Modules | a first PR, then 1 per domain |

Track 3:

- First PR: `once()`, the rule 5 root list, rules 8–11, Biome `noImportCycles`, the smoke test and
  the doc changes. Every unmigrated file goes into `TODO`.
- Then one PR per domain, in order:
  1. outbox, categories, members (+ `sessions`), allowed-senders, balances, expenses, settings,
     income
  2. transactions (+ duplicate-apply, + worker)
  3. receipts (+ worker)
  4. cdr (+ worker)
  5. email
  6. cashflow
- Each PR adds its module to the smoke test and deletes its `TODO` lines. The last leaves `TODO`
  empty.
- Tracks 1 and 2 go in any order.

Doc changes:

- adr004: "every domain has a module" replaces "add one only when a second consumer needs it".
  Record why no Nest packages and the tooling findings.
- `.claude/rules/server-architecture.md`: module and worker-module rows in the tier table,
  `once()`, rules 7–11, the smoke test, `route.test.ts` mocking the module, no `compose()` memo.
- `.claude/rules/bedrock-invocation.md`: only `*.worker.module.ts` imports `~/server/aws/`.

## When to revisit

| Idea | Revisit when |
|---|---|
| Full filter (shared HTTP error → body, log level, span) | a 2nd HTTP controller copies upload's catch block |
| Guard | a 2nd HTTP controller needs a signed-in check |
| Bigger interceptor (span + log wrapper) | 3+ routes hand-roll `withSpan` + log levels (today: upload, email) |
| Pipe | HTTP bodies share one failure reply |
| DI container | constructor churn makes hand wiring painful; then only a convention-based one (Seemann) |
| Nest packages | Nest ships TC39 decorators (nestjs#11414) and a pipeline without its HTTP layer, and the TS 7.1 API restores the tooling |
| `<domain>.contracts.ts` | the same `Pick` slice repeats across many callers |
| Events first | sync cross-domain calls cause failures or latency |

## Sources

- Seemann: [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/),
  [When to use a DI Container](https://blog.ploeh.dk/2012/11/06/WhentouseaDIContainer/),
  [Pure DI](https://blog.ploeh.dk/2014/06/10/pure-di/),
  [Composition Root location](https://blog.ploeh.dk/2019/06/17/composition-root-location/)
- [Stemmler: coding without a DI container](https://khalilstemmler.com/articles/software-design-architecture/coding-without-di-container)
- [Milan Jovanovic: modular monolith step by step](https://milanjovanovic.tech/blog/build-modular-monolith-dotnet-step-by-step)
- [Jason Taylor Clean Architecture](https://github.com/jasontaylordev/CleanArchitecture)
- [Jimmy Bogard: Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)
- [MediatR commercial editions](https://www.jimmybogard.com/automapper-and-mediatr-commercial-editions-launch-today/)
- [AWS Lambda best practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- Spring Modulith and NestJS docs, domain-driven-hexagon, brocoders, Gauzy (from the research
  passes)

## ADR Candidates

Run `/domain-model thoughts/designs/2026-11-09-nest-patterns-without-nest.md` to capture these as
Proposed ADRs.

- **Every domain owns a lazy module; worker-only deps live in worker modules; no Nest packages.**
  Revises adr004's module rule. Passes: touches every domain and root (hard to reverse), a reader
  would ask "why not Nest?" or "why two modules?" (surprising), and it beat strict per-domain,
  per-service and Nest options (real trade-off).
- **`DomainError` carries a `kind`, mapped by one complete record per transport.** Passes: sets
  the error contract every service and transport depends on, a reader would ask why errors don't
  map by class, and it beat `instanceof` chains and a shared map.
