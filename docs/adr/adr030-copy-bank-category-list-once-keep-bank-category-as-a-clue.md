---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-11-04'
# prettier-ignore
---

# Copy the bank feed's category list once as our own Groups and Categories, and keep each row's Bank category only as a mapped Clue

Technical Story: [2026-11-04 category groups, bank categories and filing suggestions design](../../thoughts/designs/2026-11-04-category-groups-bank-categories-filing-suggestions.md)

## Context and Problem Statement

Our Categories are a flat list of 7, and most Transactions are Unfiled. Redbark, the bank feed
([adr017](adr017-external-transaction-sync-via-cdr-redbark.md)), already files every bank row
into its own two-level list: 10 groups and 24 categories. Our sync drops that field because
`redbarkTransactionDto` strips unknown keys.

In an 80-row sample, about 80% of Redbark's categories were right, 10% wrong (AI
subscriptions as Shopping, a pub as Travel) and 10% too vague (cloud bills as "Everything
Else"). The API returns the category id and the top-level Open Banking code, but not the
sub-code Redbark routes on. Redbark rules can skip rows or send digests; they can't set a
category.

The glossary says the household keeps one Category list in one place. adr017 lets the bank
feed change.

How should our Categories relate to the bank feed's categories?

## Decision Drivers

- **The household owns the list.** It renames, merges and splits Categories without asking
  the feed.
- **Use the feed's 80%.** Its guess on every bank row is free and mostly right.
- **One list.** Two overlapping lists bring back "groceries" vs "Groceries".
- **Survive a feed change.** Swapping Redbark must not rewrite our Categories.
- **Public repo.** No feed ids or personal Expense names in a migration or test.

## Considered Options

1. **Copy once, map as a Clue.** Seed our Groups and Categories from Redbark's list, then
   own them. Each Bank category maps many-to-one to a Category and acts as one Clue.
2. **Live mirror.** Our Categories are Redbark's. Edits go through Redbark's API, and each
   row takes Redbark's category as its filing.
3. **Merge.** Keep our 7 Categories and add Redbark's beside them.
4. **Ignore the feed.** Grow our own list and file only from our history and AI.

## Decision Outcome

Chosen option: "1. Copy once, map as a Clue", because it is the only option where the
household owns one list and the feed's 80% still counts.

Specifics that bind:

- **Two levels.** A Category sits in exactly one Group. Colour belongs to the Group. A Group
  cannot be deleted while it holds a Category.
- **One custom SQL migration, ids only:**
  1. Seed 10 Groups and 26 Categories: Redbark's 24, plus Software & AI and Events.
  2. Move Expenses, and Transactions and Receipt line items filed directly, by id. A name
     already present keeps its row.
  3. Delete the old Categories; the `restrict` foreign key rolls the whole migration back
     if one is still in use.

  Run it on the Neon branch first, then prod.
- **`bank_category` lives in the categories domain** ([adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md)):
  feed id, name, group name, bank codes, and a nullable `categoryId`. Many may map to one
  Category. Deleting a Category unmaps them.
- **The migration seeds no Bank categories**, so no feed ids enter the repo. Each sync pulls
  the feed's list first. A new one whose name matches a Category maps itself; otherwise it
  stays unmapped and the Categories page flags it.
- **Bank fields on the row.** `transaction` gains `bankCategoryId` (plain text, no foreign
  key, so an unknown id never breaks a sync), `bankCode`, `merchantName` and
  `merchantCategoryCode`. They join the bank-owned set that every sync refreshes.
- **A Bank category is a Clue, never a filing.** It feeds Suggestions
  ([adr031](adr031-auto-file-only-by-rules-and-repeats-rank-by-clue-agreement.md)).
- **Bank codes are read-only.** The page lists them under each Category, but they can't move
  one by one, since the API hides sub-codes.
- **The old free-text Group becomes the Old group**: read-only, used once as a Clue, then
  dropped in a follow-up.

### Positive Consequences

- **The household edits freely.** A rename shows on every record, as before.
- **Every bank row carries a free guess,** right about 80% of the time.
- **A new feed needs only a new map.** Our Categories and filings stay put.
- **#111 gains a hint.** Rows filed under Transfers mark likely moves between own accounts.

### Negative Consequences

- **The map drifts.** A new feed category arrives unmapped and gives no Clue until placed.
- **The migration is one-way.** It deletes the old Categories; undoing it needs a database
  branch or backup.
- **Bank codes can't be re-routed.** A wrong feed category stays wrong for every row it
  holds; only the map or a Rule corrects it.
- **Two category ideas sit on one row,** the Category and the Bank category. The glossary has
  to hold the line.
- **Each sync makes one more Redbark call** to fetch the list.

## Pros and Cons of the Options

### 1. Copy once, map as a Clue

- Good, because the household owns one list.
- Good, because the feed's guess still counts on every row.
- Good, because a feed swap touches only the map.
- Bad, because the map needs care when the feed adds a category.
- Bad, because the switch-over migration deletes data.

### 2. Live mirror

- Good, because there is no map and no migration of our own list.
- Bad, because every rename or split goes through Redbark's API, and the 20% it gets wrong
  becomes our filing.
- Bad, because a feed swap rewrites our Categories.
- Bad, because manual and statement rows have no Redbark category at all.

### 3. Merge

- Good, because nothing is deleted.
- Bad, because two overlapping lists ("Utilities" twice) break "one list in one place".

### 4. Ignore the feed

- Good, because there is no feed coupling at all.
- Bad, because it throws away a free guess that is right 80% of the time, so the AI and the
  Member do more work.

## Links

- Design: [2026-11-04 category groups, bank categories and filing suggestions](../../thoughts/designs/2026-11-04-category-groups-bank-categories-filing-suggestions.md)
- Refines [adr024](adr024-category-own-domain-linked-by-id.md): a Category now sits in a Group
- Applies [adr017](adr017-external-transaction-sync-via-cdr-redbark.md), [adr022](adr022-cross-domain-data-through-the-owning-service.md), [adr023](adr023-domain-hierarchy-two-kinds-of-child-flat-folders.md)
- Related [adr031](adr031-auto-file-only-by-rules-and-repeats-rank-by-clue-agreement.md)
