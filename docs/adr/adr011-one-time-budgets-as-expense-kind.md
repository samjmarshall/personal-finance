---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-08-17'
# prettier-ignore
---

# One-time budgets are `expense` rows behind a `kind` discriminator, not a separate table

Technical Story: [2026-08-16 expense-linking/receipts/cashflow design](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)

## Context and Problem Statement

The Should-have "one-time budgets" is a planned single purchase — a fridge, flights — with an amount and an expected consumption date. Transactions link against it exactly as they do against a recurring commitment: consumed is the sum of linked Spend, remaining feeds the cash-flow projection as a spike in the expected date's bucket, and a linked Transaction must not appear on the Unplanned page.

The glossary widened **Expense** to cover both shapes — "a commitment to Spend, either recurring or one-time" — so the domain says this is one concept. The deciding structural force: [adr010](adr010-single-nullable-fk-transaction-expense-link.md) just made `transaction.expenseId` the single accounting link, and Unplanned's predicate reads that one column.

Where do one-time budgets live: the `expense` table behind a discriminator, or their own table?

## Decision Drivers

- **adr010's single FK must cover both kinds.** A second FK or a polymorphic link reopens every "is this planned?" query the single-FK decision just closed.
- **Unplanned predicate stability.** `expenseId IS NULL` must keep meaning "no plan of any kind".
- **The glossary says one concept.** Two tables would re-split the language the domain session just unified.
- **Shared read paths.** The Planned page and the projection walk recurring and one-time commitments side by side on every render.
- **Ceremony budget.** Additive nullable migration, no backfill, no second CRUD surface.

## Considered Options

1. `kind` discriminator on `expense` (`recurring | one-time`, not null, default `recurring`) with nullable `amount` + `expectedDate` columns
2. Separate `one_time_budget` table, linked by a second nullable `transaction.oneTimeBudgetId` FK or a polymorphic `linkType`/`linkId` pair

## Decision Outcome

Chosen option: "1. `kind` discriminator", because the single `transaction.expenseId` FK then covers both kinds unchanged — Unplanned's predicate, the leftJoin actuals, and the deletion invariant all hold without knowing which kind they touched.

Shape: `kind` text not null default `'recurring'`; `amount` double null and `expectedDate` timestamp null carry the one-time figures; `dueDay`/`dueMonth` (Timing) apply to both kinds; recurring rows keep fortnight/month/year Basis semantics untouched. Past-`expectedDate` one-timers collapse into a "past" group on the Planned page — the date does the work, no archive flag.

### Positive Consequences

- `transaction.expenseId`, the Unplanned predicate, and the leftJoin actual sums are untouched — one-time support costs zero query rewrites.
- The Planned page's one-time section and its "past" group are a `kind` filter, not a second query path; the projection walks one table for both spike sources.
- Migration is additive and nullable — no backfill, no downtime risk.
- The table matches the glossary: one Expense concept, two shapes.

### Negative Consequences

- Sparse columns with kind-dependent meaning: one-time rows carry meaningless fortnight/month/year zeros (those columns are `NOT NULL DEFAULT 0` today); recurring rows never fill `amount`/`expectedDate`. A reader must know the `kind` to interpret a row.
- Per-kind invariants (one-time ⇒ has `amount` + `expectedDate`) live in Zod input schemas, not the database. CHECK constraints are possible later if drift ever appears.
- Every query that treats the kinds differently carries the discriminator condition.

## Pros and Cons of the Options

### 1. `kind` discriminator on `expense`

| Pros                                                                     | Cons                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| One FK, one Unplanned predicate, one actuals join — adr010 holds as-is  | Kind-dependent column semantics; meaningless zeros on one-timers |
| One CRUD surface, one picker list, one projection walk                  | Per-kind invariants enforced in Zod, not the schema              |
| Additive nullable migration, no backfill                                | `kind` conditions sprinkle into kind-sensitive queries           |

### 2. Separate `one_time_budget` table

- Good, because every column on each table is always meaningful — no kind-dependent nulls.
- Bad, because Transactions need a second nullable FK (a both-set state to police at every write) or a polymorphic link (no real FK, no `SET NULL` invariant).
- Bad, because Unplanned becomes `expenseId IS NULL AND oneTimeBudgetId IS NULL` — and every future "planned?" consumer must remember both columns forever.
- Bad, because the Planned page and the projection each become two queries merged in app code.
- Bad, because the glossary defines one concept; a second table re-splits the language.

## Links

- Companion: [adr010](adr010-single-nullable-fk-transaction-expense-link.md) — the single-FK decision this discriminator preserves
- Design: [2026-08-16 expense-linking/receipts/cashflow design](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)
- Table home per [adr005](adr005-per-domain-drizzle-schema-files.md): `src/server/expenses/expenses.schema.ts`
