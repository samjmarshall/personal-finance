---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-01'
# prettier-ignore
---

# Keep `postgres-js` + `db.transaction()` for outbox atomicity; defer the `neon-http` / `db.batch()` swap and the container-pooling move until scale forces it

## Context and Problem Statement

[adr002](adr002-canonical-postgres-store-transactional-outbox.md) clause 2 requires that outbox rows commit in the same transaction as the canonical rows, and defers the mechanism to this ADR.

**This ADR reverses its own 2026-08-10 decision**, which chose `neon-http` + `db.batch()` and rejected the `postgres-js` status quo on platform grounds; the driver swap never shipped, and by the time the outbox came to be built the platform premises had weakened enough that keeping `postgres-js` is the honest call (the original decision is preserved in git history).

This project runs the **`postgres-js`** driver (`src/server/db/index.ts:1-2,32-35`, with an HMR connection cache on `globalThis`) against Neon Postgres. `postgres-js` supports real interactive transactions — `db.transaction(async tx => …)` — so adr002's atomicity requirement is already satisfied with the simplest possible code, and is relied on today (`reorderCategories` in `src/server/expenses/expenses.repository.ts`).

Two facts reshape the original driver question:

- **`DATABASE_URL` is Neon's pooled (PgBouncer) endpoint.** `src/env.js:30` documents `DATABASE_URL_UNPOOLED` as the *direct, non-PgBouncer* connection used by drizzle-kit for DDL — which means the everyday `DATABASE_URL` the app runs on is already the pooled one. Neon's PgBouncer fronts the connection, so the "each Vercel instance opens its own direct Postgres connection" fear the original decision was built on is largely already mitigated in the runtime path.
- **Nothing forces the swap yet.** At pre-PMF single-household scale the app sits idle most of the day and never approaches a connection ceiling. The `neon-http` win (scale-to-zero, one HTTP request per query) is real but future-facing.

The question this ADR now answers: given that `db.transaction()` already clears adr002's gate and the pooled endpoint blunts the serverless connection concern, do we swap drivers now or defer — and if deferred, what forces a revisit?

## Decision Drivers

- **adr002's atomicity guarantee.** Canonical rows and outbox rows must share one transaction boundary. Every option clears this bar; it is the gate, not a differentiator. `db.transaction()` clears it with a normal `BEGIN … COMMIT`; `db.batch()` clears it via Neon's array-transaction endpoint.
- **Present cost vs. future cost.** The swap is not free — it forces a `uuid` PK migration on any table referenced by an event payload (see below) and gives up interactive transactions everywhere. Paying that now, before any measured pressure, is speculative.
- **The pooled endpoint.** `DATABASE_URL` already routes through Neon PgBouncer, so the connection-multiplication argument that drove the original decision is mostly pre-answered.
- **Simplicity of the write path.** Interactive transactions are the more familiar and more capable primitive, and two live sites already depend on statement-to-statement data flow. Giving them up has to buy something measurable.
- **Reversibility.** Both interactive-tx sites at the time (the Category rename and `reorderCategories`, now in `expenses.repository.ts`) build their statements up front and port cleanly to `db.batch()` if the swap is ever forced. Deferring costs almost nothing to undo.

## Considered Options

1. Neon + `drizzle-orm/neon-http` + `db.batch([canonicalStmt, outboxInsert])`
2. **Keep `postgres-js` (the current driver, against Neon's pooled endpoint) + interactive `db.transaction()`**
3. Neon + `drizzle-orm/neon-serverless` `Pool` + interactive `db.transaction()`
4. Migrate off Vercel serverless to a container platform (long-lived process) with real connection pooling

## Decision Outcome

Chosen option: **"2. Keep `postgres-js` + interactive `db.transaction()`"**, because it already satisfies adr002 clause 2 with the simplest write path, the pooled `DATABASE_URL` endpoint already blunts the serverless connection concern that argued against it, and each alternative costs real migration or platform work to buy a benefit that is not yet a measured problem at single-household scale.

The swap is **deferred, not rejected.** It is revisited when any of these fire:

1. **Connection-limit errors despite the pooled endpoint** — the runtime actually hits Neon/PgBouncer connection ceilings under real concurrency.
2. **Scale-to-zero cost or cold-start becomes measurable** — an always-available connection's floor cost, or connection-setup latency, shows up in the bill or in traces.
3. **The stage-7 import pipeline forces the `transaction` uuid-PK migration anyway** — once ids are client-minted `uuid`s for other reasons, `db.batch()` becomes nearly free and the last real cost of the swap disappears.

When a trigger fires, the migration path is chosen *by which trigger fired* — the three forks below are **not pre-ranked**:

- **Fork A — Option 1 (`neon-http` + `db.batch()`).** Cheapest when trigger 3 fires: the uuid-PK migration is already paid, so the batch's no-data-flow constraint costs nothing. Keeps Vercel + Neon-branch tooling; loses interactive transactions everywhere.
- **Fork B — Option 4 (container platform + pooling).** Fits triggers 1–2: a long-lived process with PgBouncer/pgpool gives real pooling *and* keeps interactive transactions. Costs the most — abandons Vercel serverless, the Neon branch-per-preview / branch-per-worktree tooling, and better-auth's `*.vercel.run` / `*.v0.build` trust.
- **Fork C — Option 3 (`neon-serverless` `Pool`).** The lightest hatch for triggers 1–2: keeps Vercel + Neon + interactive transactions, swaps only the driver to the WebSocket pool. Both driver packages sit behind the same `@neondatabase/serverless` dependency, so it is a small change — but it reintroduces a per-instance pool lifecycle.

### Atomicity mechanism

`postgres-js` `db.transaction(async tx => …)` opens a real interactive transaction: a `BEGIN`, the caller's canonical writes and the outbox insert on the same `tx`, then `COMMIT` — one boundary, exactly what adr002 clause 2 requires. Statement-to-statement data flow is available (a canonical insert's `.returning()` id can feed the outbox row in the same transaction), so no id needs to be pre-resolved for correctness.

The outbox row's own `id` is still client-minted with `crypto.randomUUID()` — but for **idempotency-key** reasons (adr002 clause 7's `buildOutboxEvent` returns `{ id }`, the 24h Inngest dedup key), not because the driver forces pre-resolution.

### Deferred: the `db.batch()` pre-resolution constraint

This records what the swap *would* cost, so the triggers above are concrete and the inbound adr002 pointers still land somewhere.

`db.batch()` on `neon-http` posts a statement array to Neon's transaction endpoint — atomic, but with **no statement-to-statement data flow**: statement 1's generated id cannot feed statement 2. Every app table currently uses a database-generated integer identity PK:

```ts
id: integer().primaryKey().generatedByDefaultAsIdentity()
```

So under a batch, **any table whose id appears in an outbox event payload must move to a client-generated `uuid` primary key** — `transaction` for certain (the import and categorisation events key on it), and `expense` / `income` if they later gain side effects. Tables that never appear in an event payload keep identity PKs. This migration is trigger 3; it is also why Fork A becomes cheap once that migration is paid for other reasons.

### Implementation status

- **Host:** Neon is live. Production runs on it (`main` → production); local dev runs per-branch via `scripts/neon-branch.sh` (`local/<branch>` per non-`main` git branch), which the `worktree` skill and `.claude/rules/preview-teardown.md` assume. This landed driver-independently.
- **Driver:** `postgres-js` (`src/server/db/index.ts`). **Unchanged and staying** for now. The `globalThis` HMR connection cache remains needed (stateful driver).
- **Outbox write path:** built on `db.transaction()` in stage 4 (`src/server/outbox/`), per `thoughts/plans/2026-09-01-expense-linking-stage-4.md`.
- **Not done (deferred):** adding `@neondatabase/serverless`, swapping to `neon-http`, dropping `postgres`, and the `transaction` uuid-PK migration. None ship until a trigger fires.

### Positive Consequences

- **adr002 clause 2 satisfied with the simplest code, today.** No new dependency, no migration, no rewrite of the two live `db.transaction()` sites.
- **Interactive transactions stay available system-wide.** Statement-to-statement data flow is there for any future flow that needs it, not carved out behind a second driver.
- **The pooled endpoint already answers the connection concern.** `DATABASE_URL` routes through Neon PgBouncer, so per-instance connection multiplication is largely mitigated without the swap.
- **The swap stays cheap to make later.** Both existing sites port to `db.batch()`, and Fork A becomes nearly free exactly when the stage-7 uuid-PK migration lands.

### Negative Consequences

- **Scale-to-zero compute is not fully realized.** A stateful driver against Postgres has a connection/floor-cost profile that `neon-http`'s one-shot-HTTP model avoids. At current idle-most-of-the-day scale this is not yet measurable — trigger 2 exists to catch it when it is.
- **The design doc and adr002 describe a `db.batch()` / `neon-http` mechanism this ADR now defers.** The design doc is updated to match; adr002 (Accepted) is left as-is and its pointers land on the deferred-constraint section above.
- **A future forced swap still carries the uuid-PK migration.** Deferring does not remove trigger 3's cost; it bets the migration will be wanted for import-pipeline reasons anyway, making the swap incremental rather than standalone.
- **Three open forks instead of one settled path.** The revisit is deliberately not pre-decided, so a future reader inherits a choice — mitigated by tying each fork to the trigger that selects it.

## Pros and Cons of the Options

### 2. Keep `postgres-js` + interactive `db.transaction()` — chosen

Stay on the current driver against Neon's pooled endpoint. Wrap the canonical write and the outbox insert in a normal `db.transaction()`.

| Pros                                                                      | Cons                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Simplest possible write path; the familiar, most-capable transaction primitive | A stateful driver has a floor/connection-cost profile `neon-http` avoids (mitigated by the pooled endpoint) |
| Real statement-to-statement data flow; identity PKs stay as they are       | Full scale-to-zero not realized at idle                                                  |
| Zero migration work — it is what runs today                                | Defers, does not remove, the eventual uuid-PK migration if a swap is later forced         |
| No new dependency; portable to any Postgres                                |                                                                                          |

### 1. Neon + `neon-http` + `db.batch()` — deferred (Fork A)

| Pros                                                                     | Cons                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stateless per request — no pool lifecycle on serverless                  | No statement-to-statement data flow; ids must be pre-resolved             |
| Atomic array-transaction in one HTTP round-trip                          | Forces a `uuid` PK migration on any table referenced by an event payload  |
| Scale-to-zero compute; matches adr002's hourly sweep                     | Local development needs a network Neon branch — no offline database       |
| Client-minted UUID PKs are independently useful to the importer          | Lock-in to a Neon-specific endpoint; no interactive transactions anywhere |

### 3. Neon + `neon-serverless` `Pool` + interactive `db.transaction()` — deferred (Fork C)

Neon over the WebSocket driver, keeping interactive transactions.

- Good, because it is the lightest escape hatch — keeps Vercel + Neon + interactive transactions, swaps only the driver; both packages share the `@neondatabase/serverless` dependency, so it is a small change.
- Bad, because it reintroduces a per-invocation `Pool` lifecycle (connect/use/close, connection multiplication under concurrency) — the exact thing serverless makes awkward — while also taking on Neon lock-in.

### 4. Container platform + real pooling — deferred (Fork B)

Move off Vercel serverless to a long-lived Node process (e.g. Fly / Railway / Render) fronted by PgBouncer/pgpool.

- Good, because it buys real connection pooling *and* keeps interactive transactions; the "serverless connection model" driver constraint never binds again.
- Bad, because it is the highest-cost fork — it abandons Vercel serverless, the Neon branch-per-preview / branch-per-worktree tooling, and better-auth's `*.vercel.run` / `*.v0.build` origin trust. Only worth it if triggers 1–2 bite hard and Fork C is not enough.

## Links

- Refinement of: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — specifies the atomicity mechanism clause 2 requires (now `db.transaction()`; clause 2's pointer here is unchanged)
- Implemented by: `thoughts/plans/2026-09-01-expense-linking-stage-4.md` — stage 4 builds `commitWithOutbox` on `db.transaction()`
- Composes with: [adr012](archived/adr012-defer-adr004-plain-routers-for-feature-work.md) (superseded 2026-09-09) — the plain-helper `commitWithOutbox`; [adr004](adr004-domain-oriented-3-tier-server-architecture.md)'s single-`commit()` write door was deferred by adr012 and is now being executed tier by tier (both still describe a `db.batch` mechanism and now read stale against this reversal)
- Assumed by: `.claude/rules/preview-teardown.md` and the `worktree` skill — both written against Neon branching (unaffected: the host stays Neon either way)
- Vendor docs: https://neon.com/docs/serverless/serverless-driver
- Vendor docs: https://orm.drizzle.team/docs/batch-api
