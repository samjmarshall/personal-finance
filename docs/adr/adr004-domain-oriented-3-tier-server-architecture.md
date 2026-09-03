---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-10'
# prettier-ignore
---

# Domain-oriented 3-tier server architecture with factory-closure DI and an atomic `commit(writes, outboxEvents)` repository primitive

## Context and Problem Statement

`src/server/` is the unmodified `create-t3-app` layout: `api/` (four routers plus `trpc.ts` and `root.ts`), `better-auth/`, and `db/`. There is no service tier, no repository tier, and no isomorphic kernel. Routers talk straight to `ctx.db` and hold their SQL inline — `src/server/api/routers/transaction.ts` carries a `summary` procedure running five aggregate queries, alongside `list` with its own search, filter, sort and pagination logic. `post.ts` and the `post` table are dead T3 scaffold still wired into `appRouter`.

That layout is adequate for what exists — four CRUD surfaces over three tables — and it is about to stop being adequate. [adr002](adr002-canonical-postgres-store-transactional-outbox.md) introduces a second class of entry point (Inngest workers) that has no home in `src/server/api/`, and requires that canonical rows and outbox rows commit together at every write site. Under the current shape that requirement is a rule someone has to remember at each of the eleven mutation procedures, and there is nowhere for a worker and a router to share the guard that protects them.

The client/server boundary is convention-only. `import "server-only"` appears exactly once in the codebase (`src/trpc/server.ts`); nothing prevents a client component from importing anything under `src/server/`.

There are no tests of any kind — no test script, no framework, zero test files — so nothing currently constrains the seams either.

How should server code be organised so that every read and write has one obvious home, both entry-point classes share one implementation, the client/server boundary is compiler-enforced, and adr002's atomicity contract is structural rather than remembered?

## Decision Drivers

- **Structurally enforce adr002 atomicity.** The canonical-plus-outbox write must be carried by a signature, not by reviewer vigilance. This is the driver that makes the whole reorganisation worth doing now rather than later.
- **A home for the second entry-point class.** Inngest workers must live somewhere, and "somewhere" must not become a parallel `src/inngest/` tree divorced from the domains it serves.
- **One implementation behind two adapters.** A tRPC procedure and a worker that touch the same domain must share the service beneath them, not duplicate its guards.
- **Compiler-enforced client/server boundary.** Misfiled imports should be build failures, not review catches.
- **Navigability.** One consistent answer to "where does this live?", derivable without reading the code.
- **Honest ceremony budget.** This is a three-table CRUD app. Machinery that pays off on a large aggregate is pure overhead here, and the architecture must say so explicitly rather than importing ceremony by default.
- **Testable seams for a suite that does not exist yet.** Factory injection should be the default so the first tests written have somewhere to attach.

## Considered Options

1. By-domain vertical modules, named 3-tier with dotted suffixes, factory-closure DI, universal `commit(writes, outboxEvents)` primitive with pure `decide()` only where earned
2. Same 3-tier but with uniform domain-object write-sets and a `decide()` core on every domain
3. Horizontal layers (`controllers/`, `services/`, `repositories/`)
4. Adopt NestJS proper
5. Status quo — keep flat T3 routers, add workers wherever they land

## Decision Outcome

Chosen option: "1. By-domain vertical modules, named 3-tier with dotted suffixes, factory-closure DI, universal `commit(writes, outboxEvents)` primitive with pure `decide()` only where earned", because it makes adr002's atomicity a property of the repository's only write signature, gives Inngest workers a home beside the domain they serve, and — unlike option 2 — spends ceremony only where a flow's write complexity earns it, which on a three-table CRUD app is nowhere yet.

The conventions below are the **converged** form of this decision, with known refinements folded in as the decision rather than left to be re-derived through drift. `.claude/rules/server-architecture.md` is already written against this converged shape.

Specifics that bind:

- **By-domain vertical modules.** `transactions/`, `expenses/`, `income/`. Collapsed infra with no domain: `outbox/`, `inngest/`, `db/`, `better-auth/`. New behaviour from adr002 — categorisation, recurring-subscription detection, threshold alerts — lands inside `transactions/` unless it grows its own vocabulary, at which point it earns its own module.
- **Named tiers, dotted suffixes.** `*.router.ts` (tRPC adapter), `*.worker.ts` / `*.workers.ts` (Inngest adapter and its per-domain composition root), `*.service.ts`, `*.repository.ts`, `*.module.ts` (composition root), `*.schema.ts` (Drizzle tables, per [adr005](adr005-per-domain-drizzle-schema-files.md)), `*.errors.ts` (domain errors), `*.decide.ts` (pure decision core, where earned), and `*.dto.ts` for Zod schema, kept visually distinct from the Drizzle `*.schema.ts` homes. Every file declares its tier in its name.
- **Two thin adapters over one service.** The router owns Zod parsing, auth and domain-error mapping; the worker owns event schema, `step.run` and retries; both delegate to the same service. Services throw domain errors and never transport errors; a shared `toTRPCError` map owns the tRPC representation.
- **Module surface is `{ service }`.** Not `{ router, workers, service }`. Entry-point adapters are wired by their host registries — routers in `src/server/api/root.ts`, workers in `<domain>.workers.ts` feeding the Inngest functions registry — so a service-only consumer never drags the tRPC/auth or Inngest adapter graph in behind it. **The repository is never exported.** Cross-domain access is service-port to service-port, wired module to module, and the module graph stays acyclic.
- **`commit(writes, outboxEvents)` is the only write door — the heart of this ADR.** Plural: a discriminated-union list of write descriptors plus typed outbox event descriptors, executed as one atomic write — [adr003](adr003-neon-http-db-batch-for-atomic-outbox-writes.md)'s `db.transaction()` — by a shared `makeCommitWithOutbox` helper in `src/server/outbox/commit.ts`. The outbox rides the signature, which is what turns adr002's code-review rule into a structural one. Emit-only surfaces with no canonical rows use the outbox's write-less `publish`; a bare `inngest.send` from a handler is a violation.
- **`decide()` is earned, not default.** Pure cores (input + current state + injected `ctx`/`now` → write descriptors + event descriptors) are introduced only on write-heavy flows. **No flow in this app earns one today** — every current mutation is a single-row create, update or delete. The first candidate is statement import, which will fan a parsed batch into inserts, dedupe decisions and categorisation-request events. Until then, services make imperative repository calls that still terminate in `commit`. Uniform domain-object write-sets are explicitly not adopted; see option 2.
- **Reads pass through all three tiers**, even as one-line pass-throughs — they are the designated home for future scoping and must not be optimised away. Importing another domain's `*.schema.ts` tables for **read** joins is allowed; cross-domain **writes** go through service ports only.
- **Hard server/isomorphic boundary.** Every non-test file under `src/server/**` carries `import "server-only"` as its first line. `src/domain/` is the isomorphic kernel and is **isomorphic-by-need**: it starts empty and gains a resident only when client code genuinely shares something. `src/lib/constants.ts` (the priority, frequency and category vocabularies) stays where it is — `src/lib/**` is the existing client-safe surface. `decide()` functions are server-side and `server-only`-marked; purity alone does not buy a kernel seat.
- **Event and identifier authority.** `src/server/inngest/events.ts` (`EVENT_REGISTRY`) is the single naming and payload authority per adr002 clause 7. Inngest function ids, `step.run` ids and event names are byte-stable external identifiers — Inngest memoisation and replay keys — and renaming one is a deliberate act recorded in an ADR consequence note.
- **Migration shape.** Strangler, one domain per change, green at every step. `transactions/` first as the reference domain, since it is both the largest surface and the one adr002's machinery attaches to. Delete the `post` router and table rather than migrating them.

### Implementation status

Not started. No domain module, service, repository, worker, `src/domain/`, or `server-only` marker exists outside `src/trpc/server.ts`. Recorded as **Accepted** because `.claude/rules/server-architecture.md` already binds new code to exactly this shape.

Two pieces of tooling this decision assumes do not exist in this repo and must land with it: a way to run `drizzle-kit`, `tsx` and any test runner under `--conditions=react-server` (or to stub the marker), because `server-only` throws at import time otherwise; and a test framework, since there is none. `.claude/rules/server-only-boundary.md` describes a Makefile-based mechanism this project does not have.

### Positive Consequences

- **adr002 atomicity becomes structural.** `commit(writes, outboxEvents)` is the only write door and its signature carries the outbox. Forgetting the outbox stops being possible without deliberately routing around the repository.
- **"Where does this live?" has one answer** — the domain folder, the tier named by the suffix. Workers land beside the service they call.
- **The five aggregate queries in `transaction.summary` get a home.** They move to the repository, behind a service, where the router used to inline them.
- **Client bundles cannot import server code.** The `server-only` marker turns a boundary violation into a build failure.
- **Test seams exist before the tests do.** `makeTransactionsService(fakeDeps)` is injectable from the first test written, rather than requiring module mocking retrofitted later.
- **Dead scaffold leaves with the migration.** `post` is deleted rather than carried.

### Negative Consequences

- **Substantial reorganisation of a working app for behaviour that does not exist yet.** Every server file moves, to support an import pipeline and a worker tier that are not built. The honest justification is sequencing: retrofitting a single write door onto write sites after they multiply is harder than starting with one, and adr002 is the next piece of work.
- **Real ceremony on a three-table CRUD app.** A single-row `expense` update passes through router → service → repository → `commit`. On today's surface that is three indirections for one `UPDATE`.
- **Two write styles to hold once `decide()` arrives.** The "when does a flow earn it" rule must stay documented or it drifts — either everything collapses back to imperative, or ceremony creeps until option 2 is rebuilt by accident. The rule lives in `.claude/rules/server-architecture.md`.
- **Pass-through read services look like dead weight** until the first scoping requirement lands. Documented so nobody deletes them.
- **More files per domain, and cross-domain wiring is manual.** No container resolves the graph; `*.module.ts` is hand-wired.
- **The decision outruns the code**, bounded by the one-domain-per-change plan.
- **It pulls in prerequisite tooling.** The `server-only` marker is inert-to-hostile without the `react-server` condition wired into every script that imports server modules — a real cost this repo has not paid yet.

## Pros and Cons of the Options

### 1. By-domain 3-tier, factory-closure DI, `commit(writes, outboxEvents)`

Vertical domain folders with named tiers; two thin adapters over one service; the repository's single `commit` primitive executes one `db.transaction()` carrying canonical rows and outbox rows together; `decide()` extracted only where write complexity earns it; `*.module.ts` hand-wires the `make*` factories.

| Pros                                                                                     | Cons                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| adr002 atomicity enforced by the write signature, not by review                          | Large reorganisation of a working app, ahead of the behaviour that motivates it   |
| One home per concern; greppable tier suffixes; workers co-located with their domain      | Real ceremony on single-row CRUD — three indirections for one `UPDATE`            |
| Compiler-enforced server/client boundary                                                 | Two write styles to hold once `decide()` lands; needs the rule documented         |
| Injectable seams ready for a test suite that does not exist yet                          | Manual cross-domain wiring; more files per domain                                 |
|                                                                                          | Requires `--conditions=react-server` tooling this repo lacks                      |

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

- Good, because the tier vocabulary and module system are first-class and a DI container auto-resolves the graph.
- Bad, because NestJS owns the request lifecycle and would contest it with Next.js App Router.
- Bad, because a container's payoff arrives with large graphs and request-scoped providers; this graph is three domains of import-time singletons.
- Bad, because it is a far heavier migration than naming tiers that already half-exist, on a prototype.

### 5. Status quo — flat T3 routers

- Good, because zero migration cost, and it is entirely adequate for the app as it stands today.
- Bad, because adr002's atomicity becomes a rule remembered at every mutation, which is precisely the failure mode adr002 exists to eliminate.
- Bad, because Inngest workers have no home, and the default landing spot is a parallel `src/inngest/` tree divorced from the domains it serves.
- Bad, because router-inlined SQL cannot be shared with a worker, so the first piece of logic both entry points need gets duplicated.

## Links

- Enforces: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — `commit(writes, outboxEvents)` is the structural enforcement of the atomic write-plus-outbox clause
- Atomicity mechanism: [adr003](adr003-neon-http-db-batch-for-atomic-outbox-writes.md) — `commit` is a single atomic write; adr003 now keeps `postgres-js` `db.transaction()` and defers the `db.batch` swap
- Refined by: [adr005](adr005-per-domain-drizzle-schema-files.md) — the schema-location sub-decision within this architecture
- Refined by: [adr012](adr012-defer-adr004-plain-routers-for-feature-work.md) — feature work stays plain-router; executing this architecture is deferred, deliberately
- Operational statement: `.claude/rules/server-architecture.md` — the tier map, module surface and frozen-identifier rules; `.claude/rules/server-only-boundary.md` for the boundary mechanism
