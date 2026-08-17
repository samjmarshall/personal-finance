---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-08-17'
# prettier-ignore
---

# The expense-linking/receipts/cashflow feature set ships plain-router style; executing adr004's 3-tier architecture is deferred

Technical Story: [2026-08-16 expense-linking/receipts/cashflow design](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)

## Context

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) (Accepted, 2026-08-10) prescribes by-domain 3-tier modules, factory-closure DI, and a repository `commit(writes, outboxEvents)` primitive. No code implements it: `src/server/` routers remain flat tRPC files with direct db calls — the layout adr004 itself lists as option 5, "status quo".

The 2026-08-16 design introduces the first second-class entry point (Inngest workers) and the first outbox writes — the exact forces adr004 cites as its trigger. It is therefore the natural moment to execute that architecture, and the design deliberately declines. Without a record, the growing adr004-vs-code gap reads as drift, and any contributor (human or agent) touching feature work could reasonably "fix" it by smuggling a 3-tier refactor into a feature branch.

## Decision

We will build the expense-linking/receipts/cashflow feature set in the repo's current style: tRPC routers with direct db calls; `src/server/outbox/` exposing `publish()` and `commitWithOutbox(writes, events)` executed as one `db.batch()` — delivering [adr002](adr002-canonical-postgres-store-transactional-outbox.md)'s write-plus-outbox atomicity at the call sites that use it, without a repository tier; and workers as `makeRun*(deps)` factories — a pure core behind a thin `createFunction` wrapper — taking the one piece of adr004 (factory-closure testability) this work needs.

No service tier, no repository tier, no module ceremony is introduced, and none may be introduced inside feature branches. adr004 remains Accepted as the destination architecture; executing it is deferred, and is its own future effort. The revisit signal is the first guard or write path duplicated between a router and a worker.

## Consequences

- The adr004-vs-code gap is now deliberate, not drift. Feature work must not be "improved" toward 3-tier in passing.
- adr002's atomicity contract is carried by `commitWithOutbox`'s signature where it is used, but nothing structurally forces new write sites onto it — the enforcement gap adr004 exists to close stays open, policed by code review.
- Workers stay testable without Inngest via `makeRun*(fakeDeps)`.
- Every stage shipped adds router-inline read/write sites, so executing adr004 later grows strictly more expensive — the deferral has a compounding price.
- If the deferral hardens into "never", the honest move is to supersede adr004, not leave it Accepted.

## Links

- Defers: [adr004](adr004-domain-oriented-3-tier-server-architecture.md)
- Implements the outbox of: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) via [adr003](adr003-neon-http-db-batch-for-atomic-outbox-writes.md)'s `db.batch` mechanism
- Design: [2026-08-16 expense-linking/receipts/cashflow design](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)
