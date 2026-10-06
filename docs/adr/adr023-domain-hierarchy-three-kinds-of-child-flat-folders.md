---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-10-06'
# prettier-ignore
---

# A domain's child is part of its parent, a sub-resource, or its own domain, and domain folders stay flat

Technical Story: [2026-09-29 tRPC 3-tier migration design](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), revised 2026-10-06

## Context and Problem Statement

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) organises `src/server/` as one folder per domain. It says new behaviour "lands inside the domain it serves unless it grows its own vocabulary, at which point it earns its own module". It does not say where a child of a domain lives, or what makes a child earn its own folder.

Three children exist today, and each landed differently:

- **`receipt_item`** is a table in `receipts.schema.ts`. It has no page or router of its own.
- **`allowed_sender`** lives in `src/server/email/` as `allowed-sender.schema.ts` and `allowed-sender.trpc.controller.ts`. Only email uses it.
- **Category** lives in `src/server/expenses/` as `categories.schema.ts` and `categories.trpc.controller.ts`. Step 2 of the tRPC migration put it there, because a rename rewrote `expense.category` name text in the same transaction. But expenses, transactions and receipt items all file under a Category. The domain kernel already has `src/domain/categories/`, and the glossary calls Category "the single category vocabulary, not an Expense-only one".

The architecture test ([adr022](adr022-cross-domain-data-through-the-owning-service.md)) reads the first folder under `src/server/` as the domain (`domainOf`). A nested `expenses/categories/` folder would count as expenses, so no rule could see a boundary inside it.

Where does a child of a domain live, and when does it become its own domain?

## Decision Drivers

- **The test sees every boundary.** A domain boundary the architecture test cannot see will drift, as adr004's write rule did.
- **Folders match the language.** The server folder, the kernel folder and the glossary name the same thing.
- **A rename stays inside one domain.** A child that other domains copy by name turns a rename into a write across domains.
- **Ceremony budget.** A small child used by one parent should not cost a new folder, service and module.
- **A check, not taste.** A reader should be able to place a new child by answering yes-or-no questions.

## Considered Options

1. **Three kinds of child, flat folders, promote only over id links.**
2. **Nested domain folders,** such as `src/server/expenses/categories/`.
3. **Every table its own domain.**
4. **No rule.** Children stay in the parent until they hurt, as today.

## Decision Outcome

Chosen option: "1. Three kinds of child, flat folders, promote only over id links", because it keeps every domain boundary visible to the architecture test while keeping small children inside their parent.

Specifics that bind:

| Kind           | Test                                                                                             | Home                                                                                                                                      | Example                                |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Part of parent | Lives and dies with the parent row. No page or router of its own.                                | The parent's files.                                                                                                                       | `receipt_item` in `receipts.schema.ts` |
| Sub-resource   | Has its own table or controller, but only the parent domain uses it.                             | Prefixed files in the parent folder: `<parent>/<child>.schema.ts`, `<child>.trpc.controller.ts`. Its own service only if the service split rule says so. | `email/allowed-sender.*`               |
| Own domain     | Two or more other domains link to it by id, or it has its own lifecycle (made on its own page). | Top-level `src/server/<name>/`.                                                                                                           | `categories/`                          |

- **Flat only.** No nested domain folders. A domain is the first folder under `src/server/`.
- **Mirror the kernel.** Where both exist, `src/domain/<name>/` and `src/server/<name>/` share a name.
- **Promote only over id links.** A sub-resource becomes its own domain once every link to it is an id. While another domain holds a copy of its name, a rename is a write across domains, so the link changes first.
- **Category is the first promotion.** It meets the own-domain test today. Its move, and the switch of `expense.category` text to a `categoryId` link, is step 6 of the migration.
- **`auth/` holding the members service fits.** auth owns the `user` table, and members is its service under the glossary name.

### Positive Consequences

- **Every domain boundary is a folder boundary,** so adr022's test checks it with no new rule.
- **A new child has a home by checklist.** Three questions place it.
- **The server matches the kernel and glossary.** `src/server/categories/` sits beside `src/domain/categories/`.
- **Small children stay cheap.** `receipt_item` and `allowed_sender` keep their place with no new folder or module.

### Negative Consequences

- **Folders no longer show parentage.** `categories/` sits beside `expenses/` as a peer. The glossary and the dependency graph carry the relationship instead.
- **Promotion can need a data migration.** A child linked by copied name must switch to an id link first. Category's switch is a custom migration with a backfill.
- **"Own lifecycle" takes judgement.** "Made on its own page" is the working test, but a reader may still argue a borderline case.
- **More top-level folders** as children earn their own domain.

## Pros and Cons of the Options

### 1. Three kinds of child, flat folders, promote only over id links

- Good, because every boundary stays visible to the architecture test.
- Good, because the "promote only over id links" rule stops a move that would leave a write across domains behind.
- Good, because small children stay in their parent's files.
- Bad, because a promotion may wait on a data migration.

### 2. Nested domain folders

- Good, because the folder shows that Category grew out of Expense.
- Bad, because `domainOf` reads the first folder, so the test treats the child as its parent and sees no boundary.
- Bad, because Shopify's Packwerk found that nested packages blur which rules apply where.
- Bad, because Category is shared by three domains. Nesting it under one makes the other two reach inside expenses.

### 3. Every table its own domain

- Good, because the rule is trivial to apply.
- Bad, because `allowed_sender` and `receipt_item` would each get a folder, service and repository with one caller.
- Bad, because `receipt_item` cannot exist without its Receipt, so a separate domain would split one write across two services.

### 4. No rule

- Good, because nothing changes.
- Bad, because Category already sits in the wrong folder, against the kernel and glossary.
- Bad, because each new child is placed by taste.

## Links

- Refines: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — says where a child lives and when it "earns its own module"
- Related: [adr022](adr022-cross-domain-data-through-the-owning-service.md) — the architecture test that reads the first folder as the domain
- Related: [adr005](adr005-per-domain-drizzle-schema-files.md) — a sub-resource's table gets a prefixed `*.schema.ts` in the parent folder
- Related: [adr021](adr021-trpc-router-is-the-controller-tier.md) — the `<child>.trpc.controller.ts` prefix for a sub-resource's router
- Design: [2026-09-29 tRPC 3-tier migration](../../thoughts/designs/2026-09-29-trpc-3-tier-migration.md), section "Domain hierarchy"
- Sources: [Shopify, Packwerk](https://github.com/Shopify/packwerk), [Vernon, Effective Aggregate Design part II](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_2.pdf) (reference other aggregates by id)
