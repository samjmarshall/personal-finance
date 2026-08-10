---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-10'
# prettier-ignore
---

# Adopt Neon with `drizzle-orm/neon-http` and satisfy outbox atomicity via `db.batch()`, rejecting both the `postgres-js` status quo and the `neon-serverless` pool

## Context and Problem Statement

[adr002](adr002-canonical-postgres-store-transactional-outbox.md) clause 2 requires that outbox rows commit in the same transaction as the canonical rows, and defers the mechanism to this ADR.

Unlike the sibling projects that pattern came from, this project has not already chosen its Postgres host. It runs **local Docker Postgres** (`start-database.sh` spins up a `docker.io/postgres` container) through the **`postgres-js`** driver (`src/server/db/index.ts:1-18`, with an HMR connection cache on `globalThis`). That driver supports real interactive transactions — `db.transaction(async tx => …)` — so the atomicity requirement is, today, already satisfiable with the simplest possible code. There is no production database at all yet.

That makes this two entangled questions rather than one. The deployment target is Vercel (better-auth trusts `*.vercel.run` and `*.v0.build`, and reads `VERCEL_PROJECT_PRODUCTION_URL`), where each concurrent function instance opens its own connection to a directly-connected Postgres. Separately, the tooling copied into `.claude/` already assumes Neon: `.claude/rules/preview-teardown.md` describes deleting `local/<branch>` Neon branches, and the `worktree` skill is built around `scripts/neon-branch.sh` giving each worktree its own database branch.

Which Postgres host and driver does this project run on, and which mechanism satisfies adr002's same-transaction requirement?

## Decision Drivers

- **adr002's atomicity guarantee.** Canonical rows and outbox rows must share one transaction boundary. Every option must clear this bar; it is not a differentiator, it is the gate.
- **Serverless connection model.** On Vercel, function instances scale horizontally and each holds its own connection. A driver that keeps a stateful pool per instance risks connection multiplication; a one-shot HTTP request per query does not.
- **Cost at zero traffic.** This is a single-household prototype that will sit idle most of the day. Scale-to-zero compute is worth real money here, and it interacts with adr002 clause 4 — per-minute polling would pin compute open and defeat it.
- **Branch-per-preview and branch-per-worktree ergonomics.** The copied `preview-teardown` rule and `worktree` skill are already written against Neon branching. Choosing a different host means rewriting both, or dropping the workflow.
- **Simplicity of the write path.** Interactive transactions are the more familiar and more capable primitive. Giving them up needs to buy something.
- **Parity with the sibling projects.** Both run `neon-http` + `db.batch()` in production. Matching them makes their outbox code, their worker shapes and their operational experience directly transferable.

## Considered Options

1. Neon + `drizzle-orm/neon-http` + `db.batch([canonicalStmt, outboxInsert])`
2. Keep `postgres-js` (Docker in dev, a managed Postgres in prod) + interactive `db.transaction()`
3. Neon + `drizzle-orm/neon-serverless` `Pool` + interactive `db.transaction()`

## Decision Outcome

Chosen option: "1. Neon + `drizzle-orm/neon-http` + `db.batch([canonicalStmt, outboxInsert])`", because `db.batch()` maps to Neon's array-transaction endpoint — the server wraps the statements in a single `BEGIN … COMMIT` over one HTTP round-trip — which clears adr002's atomicity gate with no stateful pool, while Neon branching is what the already-copied preview and worktree tooling is written against.

Option 2 is rejected reluctantly and on grounds that are about the platform, not the code: it is genuinely the simpler write path, and if this app were deployed to a long-lived Node process it would win.

### Atomicity mechanism

`db.batch()` on `neon-http` is not client-side sequencing — it posts the statement array to Neon's transaction endpoint, which executes them in one server-side transaction. `drizzle-orm@^0.41.0` and `@neondatabase/serverless` both expose it, and `.returning()` works *within* a batch. The interactive form is unavailable on this driver and throws `"No transactions support in neon-http driver"`.

The one real limitation: **no statement-to-statement data flow**. Statement 1's generated id cannot feed statement 2's values. All ids must be resolved before the batch is built, with `crypto.randomUUID()`.

This has a concrete migration cost here that it did not have in the sibling projects, and it is the sharpest edge of this decision. Every app table currently uses a database-generated integer identity PK:

```ts
id: integer().primaryKey().generatedByDefaultAsIdentity()
```

Under a batch, a canonical insert and an outbox row referencing that new row's id cannot both be in the same batch — the id does not exist until the statement runs. So **any table whose id appears in an outbox event payload moves to a client-generated `uuid` primary key.** That is `transaction` for certain (the import and categorisation events key on it), and `expense` / `income` if they later gain side effects. Tables that never appear in an event payload may keep identity PKs.

### Implementation status

Not yet started. The change is:

- Add `@neondatabase/serverless`; swap `src/server/db/index.ts` from `drizzle-orm/postgres-js` to `drizzle-orm/neon-http`. The `globalThis` connection cache exists to survive HMR with a stateful driver and is no longer needed — `neon-http` is stateless per request.
- Drop `postgres` from dependencies.
- Provision a Neon project; `DATABASE_URL` in `src/env.js` is unchanged in shape.
- Migrate `transaction` to a `uuid` PK (see above).
- `start-database.sh` becomes dev-only, or is retired in favour of a Neon dev branch.

Recorded as **Accepted** on the same basis as [adr002](adr002-canonical-postgres-store-transactional-outbox.md): the rules layer already assumes it, and it is proven on the same stack in two sibling projects.

### Positive Consequences

- **adr002 clause 2 is satisfied with no pool lifecycle.** One HTTP request per mutation; no zombie sockets or connection multiplication under concurrent Vercel invocations.
- **Compute scales to zero between imports.** Directly enables adr002's hourly sweep cadence rather than fighting it.
- **`preview-teardown.md` and the `worktree` skill become true instead of aspirational.** Branch-per-preview and branch-per-worktree are the reason those files were copied in; this is what makes them work.
- **Sibling outbox code transfers directly.** `buildOutboxEvent` / `sendPostCommit` / the sweep worker are all written against this exact driver surface.
- **Client-generated UUID PKs are independently useful.** An importer can build a whole batch of rows, with their ids, before touching the database — which is exactly the shape the statement-import pipeline wants.

### Negative Consequences

- **Interactive transactions are given up everywhere, not just in the outbox path.** Any future flow genuinely needing mid-transaction `.returning()` threading has to restructure around pre-resolved ids, or carve out a second driver for that path. This ADR rejects `neon-serverless` for the current use case only; it does not preclude a controlled, documented exception later.
- **A PK migration is now on the critical path.** `transaction` must move from integer identity to `uuid` before the first outbox event references it. Cheap now (no production data, no `drizzle/` history); expensive if deferred until after go-live.
- **A theoretical TOCTOU window on any pre-read.** Where an id is resolved by reading before the batch rather than minting a UUID, a concurrent write could intervene. At single-household scale this cannot happen in practice; it is recorded so a future multi-user deployment revisits it.
- **Local development now depends on a network service.** Offline work against a Docker container stops being the default. A Neon dev branch replaces it, and `neon-http` cannot talk to a plain local Postgres without a proxy.
- **Vendor lock-in to Neon's array-transaction endpoint.** `db.batch()` is not portable to a plain Postgres driver. Moving off Neon means revisiting every write site — mitigated by the fact that adr004 funnels them all through one `commit()` function.

## Pros and Cons of the Options

### 1. Neon + `neon-http` + `db.batch()`

| Pros                                                                     | Cons                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stateless per request — no pool lifecycle on serverless                  | No statement-to-statement data flow; ids must be pre-resolved             |
| Atomic array-transaction in one HTTP round-trip                          | Forces a `uuid` PK migration on any table referenced by an event payload  |
| Scale-to-zero compute; matches adr002's hourly sweep                     | Local offline development needs a Neon branch, not Docker                 |
| Neon branching makes the copied preview/worktree tooling work            | Lock-in to a Neon-specific endpoint                                       |
| Identical to both sibling projects — code and operational experience transfer | No interactive transactions available anywhere in the system           |

### 2. Keep `postgres-js` + interactive `db.transaction()`

Stay on the current driver: Docker Postgres locally, any managed Postgres in production. Wrap the canonical write and the outbox insert in a normal `db.transaction()`.

| Pros                                                                       | Cons                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Simplest possible write path; the familiar transaction primitive           | Each Vercel function instance holds its own TCP connection — the classic serverless exhaustion problem, needing a pooler in front |
| Real statement-to-statement data flow; identity PKs can stay as they are   | No branch-per-preview or branch-per-worktree; `preview-teardown.md` and the `worktree` skill would have to be rewritten or dropped |
| Zero migration work — it is what runs today                                | A always-on Postgres has a floor cost for an app that is idle most of the day                  |
| No vendor lock-in; portable to any Postgres                                | Diverges from both sibling projects, so none of their outbox code transfers                    |

### 3. Neon + `neon-serverless` `Pool` + interactive `db.transaction()`

Use Neon, but over the WebSocket driver, to keep interactive transactions.

- Bad, because the `Pool` lifecycle is the exact thing serverless makes awkward: per-invocation connect/use/close, with connection multiplication under concurrency. It reintroduces option 2's core problem while also taking on option 1's vendor lock-in.
- Bad, because it buys a capability this system does not need — with UUID PKs minted client-side, nothing in the write path requires mid-transaction value threading.
- Good, because it is the natural escape hatch if some future flow genuinely cannot pre-resolve its ids. Both driver packages sit behind the same `@neondatabase/serverless` dependency, so adopting it for one carved-out path later is a small change.

## Links

- Refinement of: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — specifies the atomicity mechanism clause 2 requires
- Enforced by: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — `commit(writes, outboxEvents)` is the single `db.batch` boundary in the system
- Assumed by: `.claude/rules/preview-teardown.md` and the `worktree` skill — both are written against Neon branching
- Prior art (sibling `rekurve` and `ai-insurance-claims` projects, Accepted in both — named for provenance, deliberately not cross-repo linked): rekurve's `adr017` rejects the same `neon-serverless` swap; ai-insurance-claims folds the identical mechanism into its `adr008`. Neither had to argue the host choice, because both were already on Neon.
- Vendor docs: https://neon.com/docs/serverless/serverless-driver
- Vendor docs: https://orm.drizzle.team/docs/batch-api
