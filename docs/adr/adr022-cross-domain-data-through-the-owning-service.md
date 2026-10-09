---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-09-29'
# prettier-ignore
---

# Cross-domain data goes through the owning service only, enforced by an import-scanning test with a shrinking to-do list

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md)

## Context and Problem Statement

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) says "importing another domain's `*.schema.ts` tables for **read** joins is allowed" and "cross-domain **writes** go through service ports only". Both halves have drifted:

- **The write rule drifted in the rules file.** `.claude/rules/server-architecture.md` (Schema homes) says "there is no cross-domain write ceremony — writes are direct db calls too", the opposite of adr004.
- **One cross-domain write is live.** `DrizzleEmailRepository.createPendingReceipts` imports `receipts.schema` and inserts `receipts` rows through the outbox.
- **Cross-domain reads are spread wide.** Five routers read other domains' tables (`transaction`, `expense`, `receipts`, `cashflow`, `allowed-sender`). So do `receipts.repository.ts` (reads `expenseCategories`) and `src/app/api/receipts/[id]/image/route.ts` (queries `receipts`).
- **Copies follow the joins.** `cashflow.ts` repeats the consumption query from `expense.ts`.

Code review did not stop either drift. The write rule was broken inside the file meant to state it.

Every current join is for display. None filters, sorts or pages on a joined column. The transaction list, for example, filters and sorts on `transactions` columns and selects `expenses.name` and `expenseCategories.name` to show.

May a domain read or write another domain's tables, and if not, how is the rule kept?

## Decision Drivers

- **One owner per table.** A table's rules, scoping and future household filter live in one service. A second reader that bypasses it also bypasses them.
- **The rule must hold without vigilance.** The write rule already drifted under review.
- **Migrate one domain at a time.** The rule must land before the code complies, without a big-bang change (adr004 strangler).
- **Pay only for what today needs.** No current read filters, sorts or pages across domains.
- **Keep a path for the day one does.** A cross-domain filter must have a known answer, not a fresh debate.

## Considered Options

1. **Owning service only.** Batched in-memory merges replace joins. An import-scanning test with a shrinking to-do list enforces it. Published views are the recorded next step.
2. **Keep adr004's read-join allowance.** Fix the rules file and trust review for writes.
3. **Published read-only views now.** Each domain publishes Postgres views that other domains may join.
4. **Per-domain Postgres schemas with GRANTs now.** The database refuses any cross-domain read or write.

## Decision Outcome

Chosen option: "1. Owning service only", because it is the only option that makes the boundary a failing test today while costing nothing the current reads need.

Specifics that bind:

- **A repository touches only its own domain's tables.** Anything else goes through the owning domain's service, typed as a narrow interface (a `Pick` or a local port) so a test fake is an object literal. This covers reads and writes.
- **Schema files may still import each other** for foreign keys. That is data definition, not data access.
- **A join becomes two steps.** The domain runs its own query, then makes **one batched call** per other domain (such as names by id) and merges in memory. No call happens per row. Left-join behaviour holds: a missing id gives a null.
- **Ownership moves settle the loops.** Consumption is a sum over transactions, so the transactions service owns it; `expense.consumption` and cashflow both call it. Member names come from a members service in `src/server/auth/` that reads only better-auth's `user` table.
- **Every pending receipt belongs to the receipts domain.** The member-facing receipts service gets an email-intake method next to upload create. `EmailService` calls it through a small interface. `DrizzleEmailRepository` drops `createPendingReceipts`, its `receipts.schema` import and its outbox dependency. Event names such as `receipt/email.received` stay byte-identical.
- **The dependency graph has no cycles.** Each domain calls only domains below it: categories, expenses, members, income, balances and settings at the bottom; transactions and allowed senders above them; receipts and email above that; cashflow on top.
- **Never add an upward call.** When a lower domain's page needs a higher domain's data, the client makes both calls and `httpBatchStreamLink` sends them in one request. For example, the Transactions page would call `transaction.list` and `receipts.byTransactionIds(ids)`. A top-level read service with no tables, like cashflow, is only for a real composite view.
- **An architecture test enforces it.** `src/server/architecture.test.ts` scans import specifiers under `src/server/` and `src/app/`. It fails when a service or repository imports another domain's tables, when a non-composition-root file imports another domain's repository, or when an entry point does data access. A text check also bans Drizzle's `db.query.<table>` API, because `db` carries every domain's tables and that API needs no schema import. The health route is a permanent, commented exemption: it runs `select 1` and has no domain.
- **Known violations live on a to-do list that can only shrink.** The test fails on a violation missing from the list and on a listed violation that no longer occurs. Each migration step deletes its entries, and the last step leaves the list empty. This is how Shopify's Packwerk works.
- **Published views are the next step, with a named trigger.** When a list must filter, sort or page on another domain's column, the owning domain publishes a read-only Postgres view that others may join. Per-domain Postgres schemas with GRANTs are the later hardening, which makes the boundary a database guarantee.

### Positive Consequences

- **Each table has one door.** Household scoping, when it lands, goes into one service per table and cannot be bypassed by a join elsewhere.
- **Drift fails the build.** A new cross-domain import fails the test instead of waiting for review.
- **The migration can start today.** The to-do list makes the rule true for new code now and for old code step by step.
- **Copies go.** Cashflow calls the transactions service for consumption instead of repeating the query.
- **Service tests fake other domains** with object literals, not seeded tables.

### Negative Consequences

- **More queries per list.** A list that was one join becomes one query plus one batched call per other domain. Each is still one round trip, never one per row.
- **No single snapshot.** The merged reads are separate queries, so a name renamed between them can show the old name for one request. Accepted for a household app.
- **A cross-domain filter, sort or page is not possible** until the owning domain publishes a view. That is the trigger for option 3, not a workaround.
- **The test reads source, not runtime.** It sees imports and `db.query.` text. Raw SQL naming a foreign table would slip past it.
- **More service methods.** Each domain grows batch-lookup methods that exist only for other domains.
- **Two homes touch Member data.** better-auth owns writes to the `user` table, and the members service wraps it for reads only.

## Pros and Cons of the Options

### 1. Owning service only, with a shrinking to-do list

- Good, because the boundary is a failing test, not a rule someone remembers.
- Good, because the to-do list lets the strangler proceed one domain at a time with the rule already on.
- Good, because every current join is display-only, so an in-memory merge loses nothing today.
- Bad, because lists make extra queries, and cross-domain filters wait for views.

### 2. Keep adr004's read-join allowance

- Good, because no migration work and joins stay one query.
- Bad, because the write half of the same rule already drifted under review.
- Bad, because a join bypasses the owning service, so scoping added there does not apply to the joined rows.

### 3. Published read-only views now

- Good, because joins, filters and sorts across domains keep working at database speed.
- Bad, because nothing needs them today. Every view is a migration and a second shape to keep in sync.
- Bad, because views serve only reads, so writes still need option 1's rule.

### 4. Per-domain Postgres schemas with GRANTs now

- Good, because the database itself refuses a cross-domain read or write. No test can be bypassed.
- Bad, because it needs one database role per domain, connection handling per role, and a schema move for every table.
- Bad, because it ties modules to one Postgres with role management the app does not have today.
- Bad, because it is a hardening step with no current trigger.

## Links

- Refines: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — withdraws the read-join allowance and restates the write rule the rules file drifted from
- Related: [adr005](adr005-per-domain-drizzle-schema-files.md) — schema files per domain; FK imports between them stay allowed
- Related: [adr021](adr021-trpc-router-is-the-controller-tier.md) — the controller tier that calls these services
- Refined by: [adr024](adr024-category-own-domain-linked-by-id.md) — categories joins the bottom of the dependency graph
- Related: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — the email intake's outbox write moves into the receipts domain unchanged
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md)
- Sources: [Jovanović, Modular monolith data isolation](https://milanjovanovic.tech/blog/modular-monolith-data-isolation), [Shopify, Under Deconstruction](https://shopify.engineering/shopify-monolith) (Packwerk), [Richardson, Database per service](https://microservices.io/patterns/data/database-per-service.html)
