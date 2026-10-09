---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-10-07'
# prettier-ignore
---

# A domain's child is part of its parent or its own domain, and domain folders stay flat

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), revised 2026-10-06 and 2026-10-07

## Context and Problem Statement

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) organises `src/server/` as one folder per domain. It says new behaviour "lands inside the domain it serves unless it grows its own vocabulary, at which point it earns its own module". It does not say where a child of a domain lives, or what makes a child earn its own folder.

Three children exist today, and each landed differently:

- **`receipt_item`** is a table in `receipts.schema.ts`. It has no page or router of its own.
- **`allowed_sender`** lives in `src/server/email/` as `allowed-sender.schema.ts` and `allowed-sender.trpc.controller.ts`. Only email uses it.
- **Category** lives in `src/server/expenses/` as `categories.schema.ts` and `categories.trpc.controller.ts`. Step 2 of the tRPC migration put it there, because a rename rewrote `expense.category` name text in the same transaction. But expenses, transactions and receipt items all file under a Category. The domain kernel already has `src/domain/categories/`, and the glossary calls Category "the single category vocabulary, not an Expense-only one".

The architecture test ([adr022](adr022-cross-domain-data-through-the-owning-service.md)) reads the first folder under `src/server/` as the domain (`domainOf`). A nested `expenses/categories/` folder would count as expenses, so no rule could see a boundary inside it. Prefixed files hide a boundary the same way: `email/allowed-sender.*` counts as email, so `email.repository.ts` reading the `allowed_sender` table is not a cross-domain read to the test.

Where does a child of a domain live, and when does it become its own domain?

## Decision Drivers

- **The test sees every boundary.** A domain boundary the architecture test cannot see will drift, as adr004's write rule did.
- **Folders match the language.** The server folder, the kernel folder and the glossary name the same thing.
- **A rename stays inside one domain.** A child that other domains copy by name turns a rename into a write across domains.
- **Ceremony budget.** A child that only exists inside its parent's row should not cost a new folder, service and module.
- **A check, not taste.** A reader should be able to place a new child by answering yes-or-no questions.

## Considered Options

1. **Two kinds of child, flat folders, promote only over id links.**
2. **Three kinds of child,** adding a sub-resource kept as prefixed files in its parent's folder.
3. **Nested domain folders,** such as `src/server/expenses/categories/`.
4. **Every table its own domain.**
5. **No rule.** Children stay in the parent until they hurt, as today.

## Decision Outcome

Chosen option: "1. Two kinds of child, flat folders, promote only over id links", because it puts every domain boundary on a folder line the architecture test can see, while a child that lives inside its parent's row stays in the parent's files.

Specifics that bind:

| Kind           | Test                                                                                                                                                       | Home                          | Example                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| Part of parent | All three hold: it is made and deleted with the parent row; no other domain links to it by id; it has no page or router of its own, so it only changes through the parent's router. | The parent's files.           | `receipt_item` in `receipts.schema.ts` |
| Own domain     | Any part-of-parent check fails.                                                                                                                            | Top-level `src/server/<name>/`. | `categories/`, `allowed-senders/`      |

- **One test, no middle kind.** A child that fails any part-of-parent check is its own domain, even if only one other domain uses it.
- **Flat only.** No nested domain folders. A domain is the first folder under `src/server/`.
- **Mirror the kernel.** Where both exist, `src/domain/<name>/` and `src/server/<name>/` share a name.
- **Promote only over id links.** A child becomes its own domain once every link to it is an id. While another domain holds a copy of its name, a rename is a write across domains, so the link changes first.
- **Category is the first promotion.** It has its own page and three domains link to it. Its move, and the switch of `expense.category` text to a `categoryId` link, is step 6 of the migration.
- **Allowed Sender is the second.** A Member adds and removes them on their own Settings section, through their own router. They moved from `email/allowed-sender.*` to `src/server/allowed-senders/` and `src/domain/allowed-senders/` in step 7. Email now checks the allowlist through the Allowed Senders service (adr022), not by reading the table. The table name and the `allowedSender` router key do not change.
- **`auth/` holding the members service fits.** auth owns the `user` table, and members is its service under the glossary name.

### Positive Consequences

- **Every domain boundary is a folder boundary,** so adr022's test checks it with no new rule. No child hides in another domain's folder.
- **A new child has a home by checklist.** Three yes-or-no questions place it, and there is no middle kind to argue over.
- **The server matches the kernel and glossary.** `src/server/categories/` sits beside `src/domain/categories/`, and `allowed-senders/` beside its kernel twin.
- **Children inside a parent row stay cheap.** `receipt_item` keeps its place with no new folder or module.
- **Email's allowlist read becomes visible.** Once it goes through a service, the test enforces it. After step 7 moves the receipt write too, email may need no repository.

### Negative Consequences

- **Folders no longer show parentage.** `categories/` sits beside `expenses/`, and `allowed-senders/` beside `email/`, as peers. The glossary and the dependency graph carry the relationship instead.
- **A child with one user still gets a folder.** `allowed-senders/` serves only email and the Settings page.
- **Promotion can need a data migration.** A child linked by copied name must switch to an id link first. Category's switch is a custom migration with a backfill.
- **Gaining a page or router forces a move.** A future "all line items" page would move `receipt_item` out to its own domain.
- **More top-level folders** as children earn their own domain.

## Pros and Cons of the Options

### 1. Two kinds of child, flat folders, promote only over id links

- Good, because every boundary stays visible to the architecture test, including a child only one domain uses.
- Good, because one test places a child, with no middle kind to judge.
- Good, because the "promote only over id links" rule stops a move that would leave a write across domains behind.
- Good, because children that live inside the parent row stay in its files.
- Bad, because a child with one user still costs a folder.
- Bad, because a promotion may wait on a data migration.

### 2. Three kinds of child, with a sub-resource

A sub-resource has its own table or controller, but only its parent domain uses it. It lives as prefixed files in the parent folder, such as `email/allowed-sender.*`.

- Good, because a child with one user costs no new folder.
- Bad, because `domainOf` reads the first folder, so a sub-resource counts as its parent. `email.repository.ts` reads the `allowed_sender` table and the test sees no cross-domain read.
- Bad, because "only the parent uses it" breaks the day a second domain does, and the child must move then.
- Bad, because its test overlaps the own-domain test. Allowed Sender is used only by email, yet it is made on its own Settings section.

### 3. Nested domain folders

- Good, because the folder shows that Category grew out of Expense.
- Bad, because `domainOf` reads the first folder, so the test treats the child as its parent and sees no boundary.
- Bad, because Shopify's Packwerk found that nested packages blur which rules apply where.
- Bad, because Category is shared by three domains. Nesting it under one makes the other two reach inside expenses.

### 4. Every table its own domain

- Good, because the rule is trivial to apply.
- Bad, because `receipt_item` cannot exist without its Receipt, so a separate domain would split one write across two services.

### 5. No rule

- Good, because nothing changes.
- Bad, because Category already sits in the wrong folder, against the kernel and glossary.
- Bad, because each new child is placed by taste.

## Links

- Refines: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — says where a child lives and when it "earns its own module"
- Related: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — the architecture test that reads the first folder as the domain
- Related: [adr005](adr005-per-domain-drizzle-schema-files.md) — a part-of-parent table lives in the parent's `*.schema.ts`
- Related: [adr021](adr021-trpc-router-is-the-controller-tier.md) — a child with a router is its own domain, so its controller is `<name>.trpc.controller.ts` in its own folder
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), section "Domain hierarchy"
- Sources: [Shopify, Packwerk](https://github.com/Shopify/packwerk), [Vernon, Effective Aggregate Design part II](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf) (reference other aggregates by id)
