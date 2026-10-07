---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-09'
# prettier-ignore
---

# Domain-oriented 3-tier server architecture with class-based constructor injection and an atomic `commit(writes, outboxEvents)` repository primitive

> **Revised in place 2026-09-09** (originally accepted 2026-08-10). Two things changed: the DI shape moved from factory closures (`make*(deps)` returning functions) to classes built with a single constructor deps object (`new X({ … })`), and entry-point adapters are `*.controller.ts` rather than `*.worker(s).ts`. Execution started the same day with `src/server/outbox/` and `src/server/receipts/`. The write-door and frozen-identifier decisions are unchanged. [adr012](archived/adr012-defer-adr004-plain-routers-for-feature-work.md), which deferred this ADR, is superseded.

> **Refined 2026-09-29** by [adr021](adr021-trpc-router-is-the-controller-tier.md) (the tRPC router is the controller tier; `<domain>.<transport>.controller.ts` replaces `*.router.ts`) and [adr022](adr022-cross-domain-data-through-the-owning-service.md) (the read-join allowance is withdrawn). The bullets they change are tagged below; the original text stays.

## Context and Problem Statement

`src/server/` is the unmodified `create-t3-app` layout: `api/` (four routers plus `trpc.ts` and `root.ts`), `better-auth/`, and `db/`. There is no service tier, no repository tier, and no isomorphic kernel. Routers talk straight to `ctx.db` and hold their SQL inline — `src/server/api/routers/transaction.ts` carries a `summary` procedure running five aggregate queries, alongside `list` with its own search, filter, sort and pagination logic. `post.ts` and the `post` table are dead T3 scaffold still wired into `appRouter`.

That layout is adequate for what exists — four CRUD surfaces over three tables — and it is about to stop being adequate. [adr002](adr002-canonical-postgres-store-transactional-outbox.md) introduces a second class of entry point (Inngest workers) that has no home in `src/server/api/`, and requires that canonical rows and outbox rows commit together at every write site. Under the current shape that requirement is a rule someone has to remember at each of the eleven mutation procedures, and there is nowhere for a worker and a router to share the guard that protects them.

The client/server boundary is convention-only. `import "server-only"` appears exactly once in the codebase (`src/trpc/server.ts`); nothing prevents a client component from importing anything under `src/server/`.

There are no tests of any kind — no test script, no framework, zero test files — so nothing currently constrains the seams either.

How should server code be organised so that every read and write has one obvious home, both entry-point classes share one implementation, the client/server boundary is compiler-enforced, and adr002's atomicity contract is structural rather than remembered?

### Revision context (2026-09-09)

Between acceptance and this revision the 2026-08 feature set shipped under [adr012](archived/adr012-defer-adr004-plain-routers-for-feature-work.md)'s deferral: routers stayed plain, and the first Inngest workers landed as the one piece of this ADR the design kept — factory closures. In practice they nested: `makeProcessReceiptWorker({ db, inngest, model })` built `makeRunProcessReceipt({ db, fetchBlob, generate, hash })`, whose deps were themselves bare functions. The result reads as a function returning a function over functions of functions; there is no noun to point at for "the thing that fetches a blob" and no place a second entry point could share. A Vitest suite (400+ tests) now exists, so the "seams for a suite that does not exist" driver is met and the question narrows to: **which DI shape do the tiers take?**

## Decision Drivers

- **Structurally enforce adr002 atomicity.** The canonical-plus-outbox write must be carried by a signature, not by reviewer vigilance. This is the driver that makes the whole reorganisation worth doing now rather than later.
- **A home for the second entry-point class.** Inngest workers must live somewhere, and "somewhere" must not become a parallel `src/inngest/` tree divorced from the domains it serves.
- **One implementation behind two adapters.** A tRPC procedure and a worker that touch the same domain must share the service beneath them, not duplicate its guards.
- **Compiler-enforced client/server boundary.** Misfiled imports should be build failures, not review catches.
- **Navigability.** One consistent answer to "where does this live?", derivable without reading the code.
- **Honest ceremony budget.** This is a three-table CRUD app. Machinery that pays off on a large aggregate is pure overhead here, and the architecture must say so explicitly rather than importing ceremony by default.
- **Testable seams.** Every tier is constructed with explicit deps so a test can hand it plain fakes without module mocking.
- **Readable dependency graph (added 2026-09-09).** A dependency is a named object with methods, not an anonymous function. A reader should be able to name each collaborator and find its implementation by filename.

## Considered Options

1. By-domain vertical modules, named 3-tier with dotted suffixes, **class-based constructor injection** (`new X({ deps })`), universal `commit(writes, outboxEvents)` primitive with pure `decide()` only where earned
2. Same 3-tier but with uniform domain-object write-sets and a `decide()` core on every domain
3. Horizontal layers (`controllers/`, `services/`, `repositories/`)
4. Adopt NestJS proper
5. Status quo — keep flat T3 routers, add workers wherever they land

DI shapes weighed for option 1 at the 2026-09-09 revision:

- 1a. Factory closures — `makeService(deps)` returns an object of closures (the original 2026-08-10 choice)
- 1b. Classes with one constructor deps object and explicit `private readonly` fields — **chosen**
- 1c. Classes with TS parameter properties — `constructor(private readonly deps: XDeps)`
- 1d. Decorators + a DI container (folds into option 4)

## Decision Outcome

Chosen option: "1. By-domain vertical modules, named 3-tier with dotted suffixes, class-based constructor injection, universal `commit(writes, outboxEvents)` primitive with pure `decide()` only where earned", with DI shape **1b**, because it makes adr002's atomicity a property of the repository's write signature, gives Inngest workers a home beside the domain they serve, spends ceremony only where a flow's write complexity earns it, and — unlike closures — names every collaborator as a class or interface a reader can grep for.

The conventions below are the **converged** form of this decision. `.claude/rules/server-architecture.md` is the operational statement and `src/server/outbox/` + `src/server/receipts/` are the reference implementations.

Specifics that bind:

- **By-domain vertical modules.** `transactions/`, `expenses/`, `income/`, `receipts/`. Collapsed infra with no domain: `outbox/`, `inngest/`, `db/`, `better-auth/`. New behaviour lands inside the domain it serves unless it grows its own vocabulary, at which point it earns its own module. _(Where a child lives, and when it earns its own module, set by [adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md).)_
- **Named tiers, dotted suffixes.** `*.controller.ts` (entry-point adapter: Inngest `createFunction` declarations or an HTTP route handler), `*.router.ts` (tRPC adapter, until routers migrate and become controllers), `*.service.ts`, `*.repository.ts`, `*.<adapter>.ts` for one external system behind an interface (`receipts.blob-store.ts`, `email.mailbox.ts`), `*.module.ts` (composition root, optional), `*.schema.ts` (Drizzle tables, per [adr005](adr005-per-domain-drizzle-schema-files.md)), `*.errors.ts`, `*.decide.ts` (pure decision core, where earned), and `*.dto.ts` for Zod schema, kept visually distinct from the Drizzle `*.schema.ts` homes. Every file declares its tier in its name. _(`*.router.ts` and `*.controller.ts` replaced by `<domain>.<transport>.controller.ts` in [adr021](adr021-trpc-router-is-the-controller-tier.md).)_
- **Class-based constructor injection.** Each tier is a class. One `interface XDeps` sits directly above it and the constructor takes exactly that object: `new ReceiptsService({ repository, blobStore, languageModel })`. Fields are explicit `private readonly`, assigned in the constructor — no parameter properties, no decorators, no container. Repositories and adapters are exported as an interface plus an implementation class (`ReceiptsRepository` / `DrizzleReceiptsRepository`, `ReceiptBlobStore` / `VercelReceiptBlobStore`); the service types its deps as the interfaces, the controller types `service` as the class. **No dep is a bare function**, and no `make*()` factory returns closures.
- **Thin adapters over one service.** The controller owns the Inngest declaration (id, triggers, retries, concurrency) or the route's verify/parse/filter, maps `attempt` to `isFinalAttempt`, and calls one service method; the router owns Zod parsing, auth and domain-error mapping. Both delegate to the same service. Services throw domain errors and never transport errors.
- **Module surface is `{ service }`.** `*.module.ts` is added only when a second consumer needs the same service instance; with one consumer the composition root (`src/server/inngest/functions.ts` for workers) does the `new` calls directly and is the only place the real `db`, `inngest` client and provider SDKs are touched. `outbox.module.ts` is the first module: its `outboxService` is shared by the cron controller, the unmigrated routers' `commitWithOutbox` shim and the inbound repository's write door. An HTTP route file (`src/app/api/receipts/inbound/route.ts`) is its own composition root — it reads the env, builds its tiers lazily on first request and hands the `Request` to `controller.handle`. **The repository is never exported across domains.** Cross-domain access is service-port to service-port, and the module graph stays acyclic.
- **`commit(writes, outboxEvents)` is the write door for any write with side-effects — the heart of this ADR.** A discriminated-union list of write descriptors plus typed outbox event descriptors, executed as one atomic write — [adr003](adr003-neon-http-db-batch-for-atomic-outbox-writes.md)'s `db.transaction()` — by `OutboxService.commit` (`src/server/outbox/outbox.service.ts`) over `OutboxRepository.commit`. A migrated repository takes it as the `OutboxWriteDoor` interface (`DrizzleEmailRepository.createPendingReceipts`); unmigrated routers reach the same instance through the bound `commitWithOutbox` export in `src/server/outbox/index.ts`. The outbox rides the signature, which is what turns adr002's code-review rule into a structural one. Emit-only surfaces use the outbox's write-less `publish`; a bare `inngest.send` from a handler is a violation. A write that emits **no** event (a status transition, a hash column) may call Drizzle directly inside its repository, as `DrizzleReceiptsRepository` does.
- **`decide()` is earned, not default.** Pure cores (input + current state + injected `ctx`/`now` → write descriptors + event descriptors) are introduced only on write-heavy flows. **No flow in this app earns one today** — every current mutation is a single-row create, update or delete. Until then, services make imperative, intent-named repository calls (`markDuplicate`, `saveExtraction`). Uniform domain-object write-sets are explicitly not adopted; see option 2.
- **Reads pass through all three tiers**, even as one-line pass-throughs — they are the designated home for future scoping and must not be optimised away. Importing another domain's `*.schema.ts` tables for **read** joins is allowed (the receipts repository reads `categories`); cross-domain **writes** go through service ports only. _(Read-join allowance withdrawn by [adr022](adr022-cross-domain-data-through-the-owning-service.md): reads go through the owning service too.)_
- **Server/isomorphic boundary — marker still deferred.** `src/domain/` is the isomorphic kernel and is **isomorphic-by-need**: it gains a resident when client code genuinely shares something, or when it is a domain's DTO ↔ interface contract (a Zod DTO and the type it parses to) — those stay together here even when only the server reads them, such as the Bedrock extraction schema and the inbound email webhook body. `src/lib/constants.ts` stays where it is — `src/lib/**` is the existing client-safe surface. The `import "server-only"` marker on every `src/server/**` file remains the intent, but is not adopted until the `--conditions=react-server` tooling it needs is paid for (see Implementation status).
- **Event and identifier authority.** `src/server/inngest/events.ts` (`EVENT_REGISTRY`) is the single naming and payload authority per adr002 clause 7. Inngest function ids, crons, event triggers, `step.run` ids and concurrency keys are byte-stable external identifiers — Inngest schedule, memoisation and replay keys — pinned by `src/server/inngest/registry-golden.test.ts`. Renaming one is a deliberate act recorded in an ADR consequence note.
- **Migration shape.** Strangler, one domain per change, green at every step, never inside a feature diff. Executed order: `outbox/` (exemplar), `receipts/` worker, the `/api/receipts/inbound` route; next the tRPC routers with `transactions/` as the reference router domain. The dead `post` router and table are already gone.

### Implementation status

In progress since 2026-09-09.

- **Done:** `src/server/outbox/` — `OutboxInngestController` (`outbox-sweep`, `outbox-prune`) → `OutboxService` → `OutboxRepository` / `DrizzleOutboxRepository`. `src/server/receipts/` — `ReceiptsInngestController` (`process-receipt`) → `ReceiptsService` → `ReceiptsRepository` / `DrizzleReceiptsRepository`, with `ReceiptBlobStore` / `VercelReceiptBlobStore` as the adapter and the AI SDK `LanguageModel` injected as `languageModel` (Bedrock is bound to it only in `functions.ts`; the service calls `generateObject` itself). `/api/receipts/inbound` — `EmailHttpController` (Svix verify, parse, type filter; plain `Request` → `Response`) → `EmailService` → `EmailRepository` / `DrizzleEmailRepository`, with `InboundMailbox` / `ResendInboundMailbox` as the adapter, `ReceiptBlobStore.write` for the blob and the route file as its lazy composition root. The former `commit.ts` / `ack.ts` are folded into `OutboxRepository.commit` + `OutboxService.commit` / `publish`; `outbox.module.ts` exports the shared `outboxService`. Each tier has a colocated test with object-literal fakes. `src/server/transactions/` — `transactions.trpc.controller.ts` → `TransactionsService` → `TransactionsRepository` / `DrizzleTransactionsRepository`, the reference tRPC domain. `src/server/expenses/` — `expenses.trpc.controller.ts` → `ExpensesService` → `ExpensesRepository` / `DrizzleExpensesRepository`; `ExpensesService.namesByIds` returns Expense names only. `src/server/categories/` — `categories.trpc.controller.ts` → `CategoriesService` → `CategoriesRepository` / `DrizzleCategoriesRepository`, a top-level domain ([adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md), [adr024](adr024-category-own-domain-linked-by-id.md)); the transaction list's Category names come through `CategoriesService.namesByIds`, not a join. `src/server/income/` — `income.trpc.controller.ts` → `IncomeService` → `IncomeRepository` / `DrizzleIncomeRepository`. `src/server/balances/` — `balances.trpc.controller.ts` → `BalancesService` → `BalancesRepository` / `DrizzleBalancesRepository`. `src/server/settings/` — `settings.trpc.controller.ts` → `SettingsService` → `SettingsRepository` / `DrizzleSettingsRepository`; `src/server/auth/` — `MembersService` → `MembersRepository` / `DrizzleMembersRepository`, a read-only name lookup over better-auth's `user` table; `src/server/email/` — `allowed-sender.trpc.controller.ts` → `AllowedSenderService` → `AllowedSenderRepository` / `DrizzleAllowedSenderRepository`; the allowlist's owner names come through `MembersService.namesByIds`, not a join. `src/server/cashflow/` — `cashflow.trpc.controller.ts` → `CashflowService`, with no repository; it calls the transactions, expenses, income, settings and balances services and hands their results to `buildCashflow`. Consumption comes from `TransactionsService.consumedByExpense`, not a copied query. The step-1 foundation: `src/server/errors/` (domain errors, `parseError`, `assertRow`, `rethrowFkConflict`), the tRPC error-mapping middleware, `ctx.services` via `src/server/api/services.ts` / `context.ts`, and `src/server/architecture.test.ts` ([adr021](adr021-trpc-router-is-the-controller-tier.md), [adr022](adr022-cross-domain-data-through-the-owning-service.md)).
- **Next:** receipts (step 7), the last router, when the bound `commitWithOutbox` shim retires.
- **Deferred:** the `server-only` marker. It needs a way to run `drizzle-kit`, `tsx` and Vitest under `--conditions=react-server` (or to stub the marker), because `server-only` throws at import time otherwise. No rule file describes that mechanism yet.

### Positive Consequences

- **adr002 atomicity becomes structural.** `OutboxService.commit(writes, outboxEvents)` is the write door for anything that emits and its signature carries the outbox. Forgetting the outbox stops being possible without deliberately routing around it.
- **"Where does this live?" has one answer** — the domain folder, the tier named by the suffix. Controllers land beside the service they call.
- **Every collaborator has a name.** `blobStore.read`, `mailbox.download`, `repository.markDuplicate` replace `fetchBlob`, `generate`, `hash` function params. The graph is greppable by class and interface name.
- **Fakes are object literals.** A service test builds `new ReceiptsService({ repository, blobStore, languageModel })` from plain objects typed against the interfaces — no `any`, no module mocking. The model is the one SDK-typed dep; the test stubs it and spies the private `analyzeReceipt`, so `generateObject` never runs.
- **The five aggregate queries in `transaction.summary` get a home.** They move to the repository, behind a service, where the router used to inline them.
- **Client bundles cannot import server code** — once the `server-only` marker lands.

### Negative Consequences

- **Real ceremony on single-row work.** A cron that calls one method is a 20-line controller class; a single-row `expense` update will pass through controller → service → repository. Accepted for uniformity: every tier reads the same way.
- **The write door is partly structural.** Event-less writes may still call Drizzle inside a repository, so nothing forces a new write site that *should* emit onto `commitWithOutbox`. Code review still polices that classification.
- **Two write styles to hold once `decide()` arrives.** The "when does a flow earn it" rule must stay documented or it drifts. The rule lives in `.claude/rules/server-architecture.md`.
- **Pass-through read services look like dead weight** until the first scoping requirement lands. Documented so nobody deletes them.
- **Cross-domain wiring is manual.** No container resolves the graph; `functions.ts` and any `*.module.ts` are hand-wired.
- **Two shapes coexist during the strangler.** Plain routers with inline SQL sit beside class-based domains until each router migrates.
- **The `server-only` marker is still unpaid.** The boundary stays convention-only until the `react-server` condition is wired into every script that imports server modules.

## Pros and Cons of the Options

### 1. By-domain 3-tier, class-based constructor injection, `commit(writes, outboxEvents)`

Vertical domain folders with named tiers; a controller per entry point over one service; repositories and external adapters behind interfaces; `commitWithOutbox` executes one `db.transaction()` carrying canonical rows and outbox rows together; `decide()` extracted only where write complexity earns it; the composition root hand-wires `new` calls.

| Pros                                                                                     | Cons                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| adr002 atomicity enforced by the write signature for emitting writes, not by review      | Reorganisation of a working app, domain by domain, ahead of some of the behaviour   |
| One home per concern; greppable tier suffixes; controllers co-located with their domain  | Real ceremony on single-row CRUD — three indirections for one `UPDATE`            |
| Named collaborators; fakes are object literals against interfaces                        | Two write styles to hold once `decide()` lands; needs the rule documented         |
| Compiler-enforced server/client boundary (once `server-only` tooling is paid)            | Manual wiring; more files per domain; two shapes coexist during the strangler     |

DI shapes within option 1:

- **1a. Factory closures.** Good, because minimal syntax and no `this`. Bad, because closures nest into functions returning functions, deps default to bare functions with no name to grep for, and there is no class or interface for a second entry point to share. This is what the 2026-08 workers became, and the reason for this revision.
- **1b. Classes with one deps object and explicit `private readonly` fields — chosen.** Good, because `new X({ … })` names the collaborator set at every call site, ports are interfaces so fakes are object literals, and the fields are plain erasable TS (no `experimentalDecorators`, biome-neutral). Bad, because a few lines of constructor boilerplate per class.
- **1c. TS parameter properties.** Good, because zero boilerplate. Bad, because `constructor(private readonly deps: XDeps)` hides the field list, is not erasable-syntax-safe, and reads differently from every other declaration in the file. Easy to flip to later if the boilerplate grates.
- **1d. Decorators + container.** See option 4.

### 2. Same 3-tier with uniform domain-object write-sets

Uniform domain-object write-sets: every service method returns a domain-object write-set, every domain gets a pure decision core, and the repository maps domain objects to rows uniformly.

- Good, because one uniform mental model — every write everywhere reads the same way, and service purity is maximal.
- Bad, because that shape earns its keep on a multi-child append-only aggregate. There is no such aggregate here: `transaction`, `expense` and `income` are flat, independent, single-row entities with no children.
- Bad, because every current mutation would assemble a one-element write-set — pure ceremony, directly against the ceremony-budget driver.
- Bad, because `commit(writes, outboxEvents)` already captures the entire atomicity payoff. The extra fidelity buys uniformity, not safety.

### 3. Horizontal layers (`controllers/`, `services/`, `repositories/`)

- Good, because each tier is trivially discoverable as a top-level folder, and it is the smallest conceptual step from the current `api/routers/` layout.
- Bad, because a single domain change fans out across three distant folders — the opposite of the navigability driver.
- Bad, because it offers no natural seam for the client/server boundary, which is domain-shaped (shared vocabularies, shared schemas), not tier-shaped.
- Bad, because it gives Inngest workers no obvious home: they are neither controllers nor services.

### 4. Adopt NestJS proper

- Good, because the tier vocabulary and module system are first-class and a DI container auto-resolves the graph. The controller / service / repository naming here is borrowed from it deliberately.
- Bad, because NestJS owns the request lifecycle and would contest it with Next.js App Router.
- Bad, because a container's payoff arrives with large graphs and request-scoped providers; this graph is a handful of domains of import-time singletons, wired in one file.
- Bad, because decorators need `experimentalDecorators` and reflection metadata this tsconfig (`verbatimModuleSyntax`, erasable syntax) does not carry.

### 5. Status quo — flat T3 routers

- Good, because zero migration cost, and it is entirely adequate for the app as it stands today.
- Bad, because adr002's atomicity becomes a rule remembered at every mutation, which is precisely the failure mode adr002 exists to eliminate.
- Bad, because Inngest workers have no home, and the default landing spot is a parallel `src/inngest/` tree divorced from the domains it serves.
- Bad, because router-inlined SQL cannot be shared with a worker, so the first piece of logic both entry points need gets duplicated.

## Links

- Enforces: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — `commit(writes, outboxEvents)` is the structural enforcement of the atomic write-plus-outbox clause
- Atomicity mechanism: [adr003](adr003-neon-http-db-batch-for-atomic-outbox-writes.md) — `commit` is a single atomic write; adr003 now keeps `postgres-js` `db.transaction()` and defers the `db.batch` swap
- Refined by: [adr005](adr005-per-domain-drizzle-schema-files.md) — the schema-location sub-decision within this architecture
- Refined by: [adr021](adr021-trpc-router-is-the-controller-tier.md) — the tRPC router is the controller tier; controller file names; transactions-first order
- Refined by: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — cross-domain reads and writes go through the owning service only
- Refined by: [adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md) — two kinds of child (part of parent or own domain), flat domain folders, promote only over id links
- Supersedes: [adr012](archived/adr012-defer-adr004-plain-routers-for-feature-work.md) — deferred executing this ADR for the 2026-08 feature set; the deferral ended with the 2026-09-09 revision
- Operational statement: `.claude/rules/server-architecture.md` — tier map, construction rules, test conventions and frozen-identifier rules; `.claude/rules/bedrock-invocation.md` for where the model provider is wired
- Reference implementations: `src/server/outbox/`, `src/server/receipts/`
