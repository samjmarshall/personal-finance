---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-10-06'
# prettier-ignore
---

# A linked Expense sets the Category of its Transactions and Receipt line items, read through the Expense rather than copied

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), step 6 commit C and step 7

## Context and Problem Statement

A Transaction and a Receipt line item each hold two separate links: `expenseId` to an Expense, and a Category link ([adr024](adr024-category-own-domain-linked-by-id.md) names it `categoryId`). The transaction form has two separate pickers, and nothing keeps them in sync. A Transaction linked to the Expense "Weekly shop", filed under Food, can itself be filed under Household. The Food total and the "Weekly shop" total then count it differently.

The Category link exists for one reason: an Unplanned Transaction has no Expense, but the household still files it. Once an Expense is linked, the Expense's Category should win.

An Expense can move to another Category. [adr022](adr022-cross-domain-data-through-the-owning-service.md) puts expenses below transactions and receipts, so expenses may never write their rows.

How does a linked record take its Expense's Category, and stay correct when the Expense moves?

## Decision Drivers

- **One answer per record.** A linked record has exactly one Category, the Expense's.
- **Moves follow.** Moving an Expense to another Category moves every linked record with it, at once.
- **No upward writes.** Expenses never writes transactions or receipts rows (adr022).
- **Unlinking does not lose the filing.** A record unlinked from its Expense stays filed.
- **The database guards the rule,** not only the form.

## Considered Options

1. **Read through the Expense.** `categoryId` holds a value only when no Expense is linked. A check constraint enforces it.
2. **Copy it always.** Every linked record stores the Expense's Category. A move publishes an event, and a worker rewrites linked rows.
3. **Copy it on link only.** Linking copies the Expense's Category once. Later moves do not follow.
4. **Independent links.** Today's behaviour. The two links may disagree.

## Decision Outcome

Chosen option: "1. Read through the Expense", because it is the only option where a move follows at once without expenses writing another domain's rows.

Specifics that bind:

- **The effective Category** is the Expense's `categoryId` when `expenseId` is set, else the record's own `categoryId`.
- **A check constraint** on `transaction` and on `receipt_item`: `"expenseId" IS NULL OR "categoryId" IS NULL`.
- **Linking clears.** The owning service sets `categoryId` to null when it sets `expenseId`.
- **Unlinking copies back.** The owning service copies the Expense's `categoryId` onto the record when it clears `expenseId`. Transactions and receipts calling expenses is a downward call.
- **Deleting an Expense copies back too.** A `BEFORE DELETE` trigger on `expense` (migration `0017`) unlinks each record and copies the Category in one statement. It is the database's delete rule, like adr010's `ON DELETE SET NULL`, not an Expenses write. A line item keeps its own Category if it has one, until step 7.
- **The form follows.** The Category picker shows the Expense's Category and is read-only while an Expense is linked. Read-only, not disabled, so it stays focusable and its value is read out.
- **Reads take two batched calls.** The transactions service calls `expenses.namesByIds`, which also returns each Expense's `categoryId`, then `categories.namesByIds` for the union of ids. Receipts reads the same way.
- **Existing rows are cleaned.** A migration clears `categoryId` where `expenseId` is set. Count on prod first how many disagree with their Expense's Category.
- **The receipts worker may still suggest a `categoryId`** for a line item with no Expense.
- **Ships in two feature commits,** apart from the migration's refactor commits. Transactions in step 6 commit C. Line items in their own commit at the end of step 7, in the new `ReceiptsService`. The old `receipts.ts` router would hit the check constraint as a 500, so the line-item constraint cannot ship earlier.

### Positive Consequences

- **Totals agree.** A linked record counts under the same Category in Expense and Category views.
- **A move writes one row.** Changing an Expense's Category updates `expense` only.
- **The database refuses a conflict,** even from a script or a future import.
- **The glossary rule is the code rule.** "A Transaction linked to an Expense is filed under that Expense's Category."

### Negative Consequences

- **Old filings are cleared.** Linked records that disagreed with their Expense lose their own Category in the migration.
- **`categoryId` alone misleads.** A linked record has `categoryId` null yet shows a Category. Any reader of the raw row must know the rule.
- **Reads get one call longer.** Category names wait for the Expense lookup, so the two calls run one after the other.
- **Filtering or sorting by effective Category reads a foreign column.** That is a published-view trigger under adr022.
- **A line item cannot be split from its Expense's Category.** Cleaning products bought on the "Weekly shop" Expense count as Food.

## Pros and Cons of the Options

### 1. Read through the Expense

- Good, because a move follows at once and writes one row.
- Good, because the check constraint makes a conflict impossible.
- Bad, because `categoryId` null no longer means "unfiled" on its own.
- Bad, because reads need the Expense lookup before the Category lookup.

### 2. Copy it always

- Good, because each row carries its effective Category, so reads and filters stay local.
- Bad, because a move must rewrite transactions and receipts rows. Expenses cannot do that under adr022, so it needs an outbox event and an Inngest worker.
- Bad, because rows stay stale until the worker runs.

### 3. Copy it on link only

- Good, because it is simple and reads stay local.
- Bad, because a later move leaves linked rows in the old Category, which breaks "inherit".

### 4. Independent links

- Good, because nothing changes.
- Bad, because a linked record can sit in two Categories at once, and totals disagree.

## Links

- Builds on: [adr024](adr024-category-own-domain-linked-by-id.md) — the `categoryId` links this rule governs
- Constrained by: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — no upward writes; a filter on a foreign column waits for a view
- Related: [adr010](adr010-single-nullable-fk-transaction-expense-link.md) — the single nullable `expenseId` link on a Transaction
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), section "A linked Expense sets the Category"
