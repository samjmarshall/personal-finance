---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-09-29'
# prettier-ignore
---

# The tRPC router is the controller tier: one error-mapping middleware, services on `ctx.services`, files named `<domain>.<transport>.controller.ts`

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md)

## Context and Problem Statement

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) makes controller / service / repository the shape of every server entry point. Three already follow it, each with a controller class: `OutboxController` and `ReceiptsController` (Inngest) and `EmailController` (HTTP). The nine tRPC routers in `src/server/api/routers/` do not. Each procedure queries Drizzle through `ctx.db` and throws `TRPCError` inline, and about 1,200 lines mix transport, rules and SQL. `rethrowFkConflict` is copied into `transaction.ts` and `receipts.ts`.

adr004 already says "the router owns Zod parsing, auth and domain-error mapping" and "services throw domain errors and never transport errors". It does not say how. NestJS, which lent adr004 its tier names, hides Express behind a controller class. tRPC does not hide itself: `.input()`, the auth guard and the handler all live on the procedure. Something must still turn a service's error into a `TRPCError`.

Facts from tRPC 11.18.0 source and docs:

- A procedure that throws a non-`TRPCError` yields `INTERNAL_SERVER_ERROR`, with the thrown value on `.cause`.
- A middleware can read `result.error` after `await next()` and throw a new `TRPCError` in its place. tRPC's own `outputValidatorMiddleware` does this.
- `errorFormatter` runs at serialization and reshapes only the body. It cannot change the code.
- The docs show only try/catch per resolver. A mapping middleware is supported but not an official pattern.

`observabilityMiddleware` treats `UNAUTHORIZED`, `FORBIDDEN` and `NOT_FOUND` as expected. Any other code fails the span, and 5xx codes also go to `reportError`. An unmapped `NotFoundError` would surface as a reported crash.

adr004 also names the adapter `*.router.ts` "until routers migrate and become controllers", and the existing controllers are all `<domain>.controller.ts`. Once receipts has a tRPC, an Inngest and an HTTP entry point, that name collides.

What is the controller tier for a tRPC procedure, how does it reach its service, and what are controller files called?

## Decision Drivers

- **Services stay transport-free.** A service throws the same error whether tRPC, Inngest or an HTTP route called it (adr004).
- **One place maps errors.** Error-to-code mapping should be written once, not per procedure.
- **The member sees no change.** Every code and message a member sees today must survive the move.
- **Observability stays honest.** A domain "not found" must stay an expected outcome, not a reported crash.
- **Ceremony budget.** adr004 spends ceremony only where it pays. A layer that only holds try/catch does not.
- **Testable without module mocking.** A controller test hands the procedure fake services (adr004).
- **Names find tiers.** A file name says its tier and transport, and a glob finds every controller.

## Considered Options

1. **The router is the controller.** A tRPC router object per domain, one error-mapping middleware, services on `ctx.services`.
2. **A controller class per domain.** The router calls a `*Controller` class that wraps the service in try/catch and throws `TRPCError`.
3. **Try/catch in every procedure.** The pattern the tRPC docs show.

How a procedure reaches its service, weighed within option 1:

- 1a. `ctx.services`, built once by a tRPC composition root — **chosen**
- 1b. A `*.module.ts` per domain that the router imports
- 1c. A router class, or router factory, that takes its service

File names, weighed within option 1:

- 1i. `<domain>.<transport>.controller.ts` — **chosen**
- 1ii. adr004's `*.router.ts`
- 1iii. A transport-only suffix: `<domain>.trpc.ts`, `<domain>.inngest.ts`
- 1iv. A bare `trpc.controller.ts` in each domain folder

## Decision Outcome

Chosen option: "1. The router is the controller", with 1a and 1i, because tRPC already puts parsing and auth on the procedure, so the only job left for a controller is error mapping, and one middleware does that once for every procedure.

Specifics that bind:

- **A tRPC controller is a router object, not a class.** `<domain>.trpc.controller.ts` exports `createTRPCRouter({ … })`. A procedure parses input (`.input(dto)`), checks auth (`protectedProcedure`) and calls **one** service method. It holds no rules, no Drizzle and no try/catch. adr004's class rules apply from the service down.
- **A procedure may call any domain's service.** tRPC paths describe what a page asks for. Domain folders describe who owns the data. `expense.consumption` may call the transactions service. Procedure paths and the client do not change.
- **Two shared domain errors.** `NotFoundError` and `ConflictError` live in `src/server/errors/`. Each extends `Error`, takes the member-facing message and an optional `{ cause }`, and imports nothing from tRPC. A domain earns its own `*.errors.ts` only when a caller must tell two failures apart by type.
- **The service owns the message. The middleware owns the code.** The repository lets the driver error bubble. The service checks `isPgViolation(error, PgViolation.X)`, throws `ConflictError` with its own message, and rethrows anything else. It throws `NotFoundError` for a missing row. One shared FK-conflict helper replaces both `rethrowFkConflict` copies.
- **One error-mapping middleware.** It maps `NotFoundError` to `NOT_FOUND` and `ConflictError` to `CONFLICT`, keeping message and cause. Anything else stays `INTERNAL_SERVER_ERROR`. A thrown `TRPCError` (auth's `UNAUTHORIZED`, Zod's `BAD_REQUEST`) passes through untouched.
- **Middleware order:** dev latency, observability, error mapping, then auth (on `protectedProcedure` only). Observability wraps the mapper, so it sees the mapped code. `publicProcedure` gets the mapper too.
- **Services on `ctx.services`.** `src/server/api/services.ts` is the tRPC composition root. It builds every service the routers need, once, at module load, and imports from a `*.module.ts` any service that another composition root also needs, so each service is built once per process. `createTRPCContext` returns `{ db, session, services, ...opts }`. The tRPC route and the RSC caller both use `createTRPCContext`, so both share one set of instances. Services hold no per-request state: a procedure passes session values as method arguments, named `memberId` and only on methods that read it.
- **The context lives apart from `trpc.ts`.** `createTRPCContext` moves to `src/server/api/context.ts`, which imports `auth`, `db` and `services.ts`. `trpc.ts` takes the context shape with `import type`, so a controller test loads no real service and needs no `vi.mock`.
- **Build-time safety.** A service built at module load must not throw when an env var is unset at build time. Any service that would gets a lazy memo, as the inbound route does for `new Resend(undefined)`.
- **`ctx.db` goes last.** It stays until the last router migrates, then `context.ts` stops importing `db`.
- **Controller names: `<domain>.<transport>.controller.ts`, class names to match.** Today's controllers are renamed: `receipts.inngest.controller.ts` (`ReceiptsInngestController`), `outbox.inngest.controller.ts` (`OutboxInngestController`), `email.http.controller.ts` (`EmailHttpController`). The receipts image and upload routes share one `receipts.http.controller.ts`. Inngest keys on function ids, never file or class names, so no wire string changes.
- **Migration order: transactions first.** It is the reference router domain. Receipts goes last, when the bound `commitWithOutbox` shim retires. This settles the contradiction in adr004, whose migration shape named transactions and whose implementation status named receipts.

### Positive Consequences

- **Error mapping is written once.** Thirty procedures lose their try/catch, and `rethrowFkConflict` stops being copied.
- **Services are transport-free and reusable.** An Inngest worker can throw and catch the same `NotFoundError` and `ConflictError`.
- **Codes and messages match today's.** Only the producer changes. `NOT_FOUND` stays expected in observability. `CONFLICT` still fails the span and logs a warning without being reported as a crash.
- **Controller tests need no module mocking and no casts.** A shared `createTestCaller(router, { services, session })` wraps `createCallerFactory(router)`. Each fake is a `Partial` of its service, so a plain object fits and its methods are checked against the real signatures.
- **Globs work.** `*.controller.ts` finds every controller. `*.trpc.controller.ts` finds every router. No folder holds two classes with the same name.

### Negative Consequences

- **tRPC entry points look different from the others.** Inngest and HTTP controllers are classes. tRPC controllers are router objects. A reader must know tRPC already owns parsing and auth.
- **Mapping is out of sight.** A procedure that throws `ConflictError` shows no `CONFLICT` near it. The reader must know the middleware exists.
- **The middleware depends on order.** Moving it outside observability would report every `NotFoundError` as a crash. `trpc.test.ts` pins the order.
- **Build-once needs care.** Every service in `services.ts` loads with the tRPC route. A service with a heavy or env-bound dependency needs a lazy memo, or it slows or breaks the build.
- **Three renames churn imports.** `registry-golden.test.ts`, `functions.ts`, the inbound route and the tests all change, in their own commit.
- **Two error shapes during the strangler.** Unmigrated routers still throw `TRPCError` inline beside migrated ones.

## Pros and Cons of the Options

### 1. The router is the controller

- Good, because tRPC's `.input()` and `protectedProcedure` already are the validation pipe and the guard. Nothing is left for a class to own except error mapping.
- Good, because a middleware maps errors once, with the same mechanism tRPC uses for output validation.
- Good, because observability sees mapped codes, so expected outcomes stay expected.
- Bad, because the mapping is implicit, and the procedure shape differs from Inngest and HTTP controllers.

Within option 1, reaching the service:

- **1a. `ctx.services` — chosen.** Good, because one composition root builds each service once, and tests hand fakes to `createCallerFactory` with no module mocking. Bad, because every service loads with the route.
- **1b. A module file per domain.** Bad, because adr004 allows a module only when a second consumer needs the same instance, and router tests would need module mocking.
- **1c. A router class or factory.** Bad, because it wraps every router in a class or closure for no gain, and adr004 bans `make*()` factories.

Within option 1, file names:

- **1i. `<domain>.<transport>.controller.ts` — chosen.** Good, because it names both tier and transport, and globs by either. Bad, because it renames three existing controllers.
- **1ii. `*.router.ts`.** Bad, because it names a fourth tier that is really the controller, and it breaks the `*.controller.ts` glob.
- **1iii. `<domain>.trpc.ts`.** Bad, because it reads like an adapter file (`email.mailbox.ts`), and adr004 wants every file to name its tier.
- **1iv. Bare `trpc.controller.ts`.** Bad, because the same name repeats in eight folders, and sub-resources such as `allowed-sender` need a prefix anyway.

### 2. A controller class per domain

- Good, because every entry point would look the same: a class over a service.
- Bad, because the class cannot own `.input()` or the auth guard, which live on the procedure. It would hold only try/catch.
- Bad, because it adds a file and a class per domain against the ceremony budget, with the same mapping written per class.

### 3. Try/catch in every procedure

- Good, because it is the pattern the tRPC docs show, and the mapping sits next to the call.
- Bad, because it is `rethrowFkConflict` copied across thirty procedures, which is the drift this ADR exists to stop.
- Bad, because a procedure that forgets it turns a domain "not found" into a reported crash.

## Links

- Refines: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — replaces `*.router.ts` with `<domain>.trpc.controller.ts`, says how the router maps domain errors, and settles the migration order as transactions first
- Related: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — what a service may read and write once it owns the domain's data
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md)
- Prior design: [2026-08-24 tRPC error parser](../../thoughts/designs/2026-08-24-trpc-error-parser.md) — ruled out result types; its "messages are contextual" objection is met by the service owning the message
- Operational statement: `.claude/rules/server-architecture.md`
- tRPC source: [procedureBuilder.ts](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/procedureBuilder.ts) (`getTRPCErrorFromUnknown`), [middleware.ts](https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/middleware.ts) (`outputValidatorMiddleware`)
