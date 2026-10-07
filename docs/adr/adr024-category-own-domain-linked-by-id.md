---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-10-06'
# prettier-ignore
---

# Category is its own domain at the bottom of the graph, and every record links to it by `categoryId`

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), step 6

## Context and Problem Statement

A Category is the household's single filing list. Expenses, Transactions and receipt items all file under one. The server code for it lives in `src/server/expenses/`, while the kernel has `src/domain/categories/` and the glossary calls it "the single category vocabulary, not an Expense-only one".

Three tables link to a Category, two ways:

- **`expense.category`** holds the Category's name as text, not null.
- **`transaction.expenseCategoryId`** and **`receipt_item.expenseCategoryId`** hold its id, with `on delete set null`.

The name text is the only reason Category sits in expenses. It ties the two together three ways:

- **A rename** rewrites `expense.category` in the same database transaction as the `expense_category` row.
- **A delete** counts Expenses by name and refuses with `Cannot delete "X" — N expenses still use it.`
- **`category.list`** joins `expense` to return `expenseCount` for the Categories page.

[adr022](adr022-cross-domain-data-through-the-owning-service.md) lets a domain reach another's data only through its service, with no upward calls. [adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md) says a child linked by two or more domains is its own domain, but may only move once every link to it is an id.

How does Category leave expenses without a rename, delete or count becoming a write or read across domains?

## Decision Drivers

- **A rename writes one table.** A rename that must update another domain's rows breaks adr022 or needs machinery.
- **No cycles.** Categories must sit below everything that files under it and call nothing.
- **Every Expense keeps a Category.** Today the column is not null. The household relies on every Expense being filed.
- **Same screens.** The Categories page still shows counts and refuses to delete a Category in use.
- **One name per idea.** The glossary has one Category, so the code should not say "expense category" for it.

## Considered Options

1. **Own domain, id links, `on delete restrict` for expenses.** Drop the name text. Expenses counts per Category.
2. **Stay in expenses.** Keep the name text and the one-transaction rename.
3. **Own domain, keep the name text, publish a rename event.** An Inngest function rewrites `expense.category` after a rename.
4. **Own domain, keep the name text, categories calls expenses on rename.**

## Decision Outcome

Chosen option: "1. Own domain, id links, `on delete restrict` for expenses", because it is the only option where a rename writes one table and the dependency graph keeps no upward call.

Specifics that bind:

| Today                                                   | After                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| table `expense_category`, export `expenseCategories`    | table `category`, export `categories`, in `src/server/categories/`                      |
| `expense.category` text, not null                       | `expense.categoryId` int, not null, FK to `category.id`, `on delete restrict`, indexed  |
| `transaction.expenseCategoryId`, `set null`             | `transaction.categoryId`, `set null`                                                    |
| `receipt_item.expenseCategoryId`, `set null`            | `receipt_item.categoryId`, `set null`                                                   |
| `transaction.category`, default "Uncategorised" (Group) | `transaction.group`, same default, kept as the legacy label for imported data           |
| `expenseCategoryId` in `receipt-extraction.dto.ts`      | `categoryId`                                                                            |

- **`restrict` for expenses, `set null` for the rest.** An Expense must be filed. A Transaction or receipt item may be unfiled.
- **The database refuses a delete in use.** `CategoriesService.delete` turns the FK violation into `ConflictError('Cannot delete "X" — expenses still use it.')`. The count leaves the message.
- **Expenses owns the count.** `ExpensesService.countsByCategory()` serves `expense.countsByCategory`. The Categories page calls it with `category.list`, in one batched HTTP request, and joins them on the client. No count is stored on `category`.
- **Names come by id.** Transactions calls `expenses.namesByIds` and `categories.namesByIds` once per page. They ran in parallel until [adr025](adr025-linked-expense-sets-the-category.md) made them run one after the other, since a linked row's Category comes from its Expense. The Expenses and Unplanned pages group by `categoryId` and take names and order from `category.list`.
- **Three migration files backfill the link.** A generated file renames the table and columns and adds a nullable `categoryId`. A custom file fills it by matching name text and points any unmatched Expense at one "Needs refiling" Category, created only if needed. A generated file then renames the id sequence, sets not null and drops the text. Three files, not one, because a custom file copies the previous snapshot, so drizzle-kit can't record the schema change in it. The sequence rename sits in the last file because drizzle-kit 0.31 crashes when a table rename and an identity rename share one diff. All three run in one `make db_migrate`, never `drizzle-kit push`.
- **Categories sits at the bottom of the graph** with expenses, members, income, balances and settings. It calls nothing.
- **Paths and page stay.** The `category.*` tRPC paths, the Categories page and its route do not change.

### Positive Consequences

- **A rename writes one row.** No cross-domain write, no event, no stale names.
- **The database guards filing.** An Expense cannot point at a missing Category, which the name text never enforced.
- **`expenses/` holds only Expense code.** The folder, kernel and glossary agree.
- **The receipts worker reads categories directly** through a narrow port on `CategoriesService`, not through expenses.

### Negative Consequences

- **A data migration with a backfill.** Expenses whose name matches no Category land in "Needs refiling" and must be refiled by hand. The name avoids "Uncategorised", which is already Group's default.
- **Renames across the stack.** `expenseCategoryId`, `expense_category` and the Group column change name in schema, DTOs, UI and tests. Old `receipt.rawJson` still holds `expenseCategoryId` and must not be re-parsed as the new shape.
- **A delete still unfiles quietly.** Transactions and receipt items filed under a deleted Category lose the link with no warning. Only Expenses block a delete.
- **The delete message loses its count.** The member sees that Expenses use the Category, not how many.
- **One more request for counts.** The Categories page asks two domains. `httpBatchStreamLink` keeps it one HTTP request.

## Pros and Cons of the Options

### 1. Own domain, id links, `on delete restrict` for expenses

- Good, because a rename and a delete each touch only the `category` table.
- Good, because the FK enforces filing, which the name text never did.
- Good, because categories calls no other domain.
- Bad, because it needs a backfill migration and many renames.

### 2. Stay in expenses

- Good, because nothing moves and the rename stays one database transaction.
- Bad, because transactions and receipts must ask expenses for Category data, which contradicts the glossary and kernel.
- Bad, because the name text stays unguarded: an Expense can hold a name that is not in the list.

### 3. Own domain, keep the name text, publish a rename event

- Good, because no schema change on `expense`.
- Bad, because a rename needs an outbox event and an Inngest function to finish.
- Bad, because Expense names stay stale until the function runs.
- Bad, because a delete still counts across domains by name.

### 4. Own domain, keep the name text, categories calls expenses on rename

- Good, because the rename stays immediate.
- Bad, because categories could no longer sit at the bottom of the graph. Once expenses checks a name against categories, the two call each other and make a cycle.
- Bad, because the rename spans two services with no shared database transaction.

## Links

- Refines: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — adds categories at the bottom of the dependency graph
- Refined by: [adr025](adr025-linked-expense-sets-the-category.md) — a linked Expense sets the Category of its Transactions and Receipt line items
- Applies: [adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md) — Category is the first promotion to its own domain
- Related: [adr005](adr005-per-domain-drizzle-schema-files.md) — `categories/categories.schema.ts` becomes a domain schema file
- Related: [adr017](adr017-external-transaction-sync-via-cdr-redbark.md) — `categoryId` and `group` stay member-owned columns that re-sync never touches
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), section "Categories as its own domain"
- Sources: [Vernon, Effective Aggregate Design part II](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf) (reference other aggregates by id)
