# Category groups, bank categories and filing suggestions

Date: 2026-11-04
Status: Design (validated in brainstorm; ready for `/write-tickets`)
Governed by: adr004 (3-tier), adr014 (data stays in Australia), adr015 (PostHog), adr017 (CDR sync via Redbark), adr022 (data through the owning service), adr029 (description scores)
Builds on: `thoughts/designs/2026-11-03-description-score-feedback-loop.md` (answers, dataset, Vitest eval project)
Related: #111 (transfers counted as spend), #112 (loan accounts out of spend)

## Problem

Most Transactions are unfiled. Filing them by hand is slow, so the Categories and Expenses
pages give a weak picture of where money goes.

- Our Categories are a flat list of 7. Redbark already files every bank row into a
  2-level list (10 groups, 24 categories), but our sync drops that field.
- In an 80-row sample, about 80% of Redbark's categories were right, 10% wrong (AI
  subscriptions → Shopping, pub → Travel) and 10% too vague (cloud bills → "Everything
  Else").
- Recurring rows (same shop, same amount, or a rare word like "Spotify") get filed the
  same way every time, by hand.

Goal: copy Redbark's list once and make it ours, keep Redbark's category on each bank row
as a clue, and add a filing engine. Member rules and exact repeats auto-file. Everything
else gets a suggestion built from agreeing clues, accepted in one click. "Save as rule"
turns each answer into automation, so AI cost and friction fall over time.

## Scope decisions

- **Copy once, then ours.** Seed Redbark's groups and categories, then rename, merge and
  split freely. Redbark stays a clue through a many-to-one map.
- **Replace, don't merge.** Move every Expense and filed row onto the new Categories, then
  delete the old 7.
- **Auto-file only rules and exact repeats.** All other filings are suggestions until the
  eval proves Strong ones safe.
- **Agreement, not AI confidence.** Strength counts agreeing clues. The AI breaks ties; it
  never files on its own.
- **Rules never touch hand-filed rows.** Rules and repeats act on unfiled rows only.
- **The old Group field retires.** "Group" becomes the parent of Categories. The old free
  text helps once as a clue, then a follow-up drops it.
- **#111 stays separate.** This work files transfer rows under Transfers. Whether a row
  counts as Spend stays #111's job.

## Verified facts

- Redbark v2 (`2026-10-01.wattle`) transaction fields: `category` (a `cat_` id),
  `provider_category` (CDR primary code only), `merchant_name`, `merchant_category_code`.
  Redbark routes on the CDR sub-code, but the API doesn't return it. So bank codes can't
  move between categories one by one.
- A Redbark category has `parent` (null for a group), `color`, `position`, `sources` (CDR
  codes) and `icon` (null).
- `redbarkTransactionDto` (`src/domain/cdr/cdr.dto.ts`) strips unknown keys, so the 4
  fields are lost today.
- Redbark's Categories page: one card per group, rows with drag handle, inline rename,
  "N bank categories", and an unfold listing CDR codes by friendly name. Its own screen
  calls the codes "bank categories". Redbark rules can't set a category.
- `category` has no parent, colour or icon. `expense.categoryId` is required and
  restricts delete.
- adr029 scoring is pair-wise (`description-score.ts`): word score (IDF cosine), meaning
  score (Titan v2, 1024 dims) and their mean. Bars: adopt word 0.55, adopt meaning 0.7,
  similar 0.59. `description_embedding` stores pgvector values keyed by (model, cleaned
  text), with no index.
- Receipt extraction already classifies with `generateObject`, a Zod schema and a listed
  `id: name` set, dropping unknown ids. The span processor prices every `ai.*` span as
  Sonnet.
- Bedrock AU inference profiles exist for `au.anthropic.claude-haiku-5-5` and
  `au.anthropic.claude-haiku-4-5-20251001-v1:0`. Both route to Sydney and Melbourne
  (4.5 may also use NZ). Sydney prices are **unconfirmed**. Haiku 5.5 has no batch mode.
- Jev isn't on Bedrock and has no Australian region (fails adr014).
- History import pulls up to 7 years from 9 accounts.
- The repo is **public**. No real descriptions or personal Expense names go in a repo file,
  migration or CI output.

## Architecture

New **`filing` module**, above transactions, since it reads transactions, expenses and
categories. Pure logic lives in `src/domain/filing/`: rule match, exact repeat, clue vote,
strength, prompt builder. It calls downward only. Sync starts it with an Inngest event,
never a direct call. It asks the CDR service for left-out account ids; that call runs
downward, since CDR starts filing only through an event, so there is no cycle.

Screens compose two reads in one request (adr022), as `receipts.byTransactionIds` does:
"To review" is `transaction.list` filtered to Unfiled rows, left-out accounts and a date
range (all the transaction's own columns), then
`filing.forRows(ids)`. "Accept all strong" runs in the filing service: its own Strong list,
then one batched "file these if still unfiled" call to the transactions service.

## Data model

**Categories module (bottom layer)**

| Table | Change |
|---|---|
| `category_group` | new: name (unique), colour, sort order |
| `category` | add `groupId` (required, restrict). Keep description. Sort order counts within the group. |
| `bank_category` | new: Redbark id, name, group name, bank codes, `categoryId` (nullable; set null on delete). Many bank categories may map to one Category. |

**Transactions module**: `transaction` gains `bankCategoryId`, `bankCode`, `merchantName`,
`merchantCategoryCode`. `bankCategoryId` is plain text with no foreign key, so an unknown
id never breaks a sync.

**Filing module**

| Table | Holds |
|---|---|
| `filing_rule` | match words, amount (exact or min/max), account, → Expense or Category (exactly one), on/off, rows filed, last used, saved by (Member, set null on delete) |
| `filing_suggestion` | one per unfiled row: Expense, Category, strength, clues (each clue's pick and reason), AI used, model |
| `filing_auto` | rows filed by a rule or repeat: reason, rule, undone |
| `filing_answer` | each Member answer: accepted, changed, rule saved, auto undone; the final pick; the Member who gave it |
| `old_group_map` | old Group text → Category; dropped with the old column |

Deleting an Expense or Category cascades to suggestions and rules that point at it.

## Switch-over migration

One custom SQL migration, keyed by row ids only:

1. Create `category_group`. Seed 10 groups with Redbark's colours.
2. Seed 26 Categories: Redbark's 24, plus Software & AI and Events under Lifestyle. A
   name that already exists keeps its row and gains a group.
3. Move Expenses, directly filed Transactions and Receipt line items to their new
   Category by id. Build the id list from the branch database at build time.
4. Delete the old Categories. If one is still in use, the restrict fails and the whole
   migration rolls back.
5. Make `groupId` required.

Run on the Neon branch first (`make db_branch_status` shows `*`), check counts, then prod.
The migration doesn't seed bank categories, which keeps Redbark ids out of the repo.

## Categories page

- Group cards fold, with a colour dot, "N categories", "Add category" and delete (blocked
  while not empty).
- Category rows: drag handle, inline rename, "3 expenses · 120 transactions", an edit
  dialog for the description (the AI prompt reads it).
- Drag reorders within a group and moves between groups.
- Unfolding a row lists its bank categories, with bank codes as small text, each with a
  "Move to…" picker. A picker beats drag for keyboards.
- Colour belongs to the group. No icons.
- A banner shows unmapped bank categories: "2 bank categories to place".
- A temporary **Old groups** card lists each distinct old Group value, its row count and a
  Category picker. It goes when the column drops.
- Every Category picker (transaction, expense, receipt item, rule) shows group headings.

## Sync

Each sync run:

1. Pull Redbark's category list and upsert `bank_category`. A new one whose name matches a
   Category maps itself; otherwise it stays unmapped. No "Refresh" button needed.
2. Read the 4 new fields through `redbarkTransactionDto`, `SyncedTransaction` and
   `mapRedbarkTransaction`.
3. Save them. Add them to the bank-owned refresh set in `upsertSynced`. An adopted
   household row gets them too.
4. Send `filing/rows.added` with the new row ids. Manual create and statement import send
   the same event.

## Engine

`filing-suggest` runs on `filing/rows.added` in chunks of 50, with concurrency key
"filing" (limit 1). It touches Unfiled rows only (no Expense, no Category) and re-checks
that inside the write. It skips rows from left-out accounts (`inBalance = false`): no Rules,
no Suggestions, no AI. Marking an account back in balance lets the nightly re-run pick its
rows up.

1. **Rules.** Every enabled rule whose words all appear in the cleaned text, plus its
   amount and account when set. The most specific wins (more conditions; ties go to the
   newest). Auto-file, reason "Rule: Spotify".
2. **Exact repeat.** At least 3 past rows with the same cleaned text, filed by a Member or a
   rule, all filed the same way, none differing. **And** the same amount every time, or a
   rare word (top word weight over a named bar). Auto-file, reason "Same as 6 past". One
   differing row stops it. A repeat never auto-files to a one-time Expense; that row becomes a
   Suggestion instead. A Rule may still point at one.
3. **Clues.** Each picks a Category; some also pick an Expense.
   - **Bank category**, through the map. "Everything Else" or unmapped gives no clue.
   - **Past matches**: the 10 closest filed rows with merged score ≥ 0.59, voting by
     score. The winner needs ≥ 60% of the vote. Search runs in app code over filed rows;
     move to a pgvector index past about 50k filed rows.
   - **Expense name**: word score ≥ 0.55 against Expense names. An amount within 10%
     adds an "amount fits" note.
   - **Old group**, when mapped.
4. **Strength.** Strong: 2+ clues agree and none disagree. Weak: 1 clue. Split: clues
   disagree. None: no clue.
5. **AI tie-break** on Weak, Split or None rows dated within 12 months, under the daily
   cap. Its pick joins as one more clue; strength is recomputed.
6. **Expense** comes from a clue naming an Expense inside the winning Category (past
   matches first, then Expense name). An Inflow row (a refund) takes an Expense only from
   evidence: a Rule, past matches or an Expense name. That keeps refunds netting into
   Consumed without the AI linking salary to an Expense.
7. **Save** the suggestion. Dots show the count of agreeing clues.

Re-checks (no AI):

- **Right away:** filing a row re-runs Unfiled rows with the same cleaned text. Saving a
  Rule offers to file matching past Unfiled rows. Changing the Bank category map or the Old
  group map re-runs the Unfiled rows that carry it.
- **Nightly:** `filing-ai-backlog` first re-runs every Unfiled row on free Clues. That
  catches new or renamed Expenses, moved Categories and fresh history without wiring a
  trigger to each.
- A stored AI Clue carries over through every re-run, so the AI never runs twice for a row.

All bars are named constants in `src/domain/filing/`, for the eval to tune.

## AI tie-break

- Port `FilingClassifier` in `src/domain/filing/`. The Bedrock binding lives only in
  `src/server/inngest/functions.ts`. Service tests use a fake.
- `generateObject` with `{ categoryId, expenseId | null }`. Unknown ids drop to no clue.
  The prompt never asks for confidence.
- Prompt, one row per call: Categories under group headings with descriptions; Expenses
  (id, name, amount and Basis, Category), for Spend rows only; the 10 closest filed rows as
  examples; the row (text, amount, date, direction, bank category, bank code, merchant,
  MCC). An Inflow row's prompt lists no Expenses and asks for a Category only.
- `BEDROCK_SUGGEST_MODEL`, default `au.anthropic.claude-haiku-5-5`. A spike confirms
  `generateObject` works through the AI SDK and checks Sydney prices. Fallback:
  `au.anthropic.claude-haiku-4-5-20251001-v1:0`.
- Cost:
  - `FILING_AI_DAILY_CALLS` (default 250), shared by every run, counted from today's
    AI-used suggestions. Over the cap, rows keep free clues and wait.
  - The span processor prices by model id from a table. Terraform locals carry Haiku
    prices beside Sonnet and Titan, so the $1/day alert stays true.
  - IAM allows the Haiku AU profile and base model in Sydney and Melbourne (plus NZ for
    4.5).
  - Telemetry on; span name `ai.filing.suggest`.

## Catch-up

Run by hand from the Inngest dashboard:

1. Re-run the history import over the full range. Rows match by bank id, so only
   bank-owned fields change, now including the 4 new ones.
2. `filing-embed-history` embeds every distinct cleaned description, skipping cached text.
3. The Member maps Old groups (optional, improves results).
4. `filing-catch-up` sends every unfiled row through the engine: rules and repeats across
   all history, free clues on every row, AI only within 12 months and under the cap. Safe
   to re-run.

`filing-ai-backlog` (daily cron) re-runs every Unfiled row on free Clues, then gives the AI
to Weak, Split and None rows within 12 months that haven't had it, up to the cap.

## Review screens

**Transactions page**

- A **To review (N)** filter: Unfiled rows from accounts in the balance, newest first, with
  a date filter.
- Each row shows a chip, "Groceries · Groceries & Food" or a Category alone, with dots
  (●●○). A one-time Expense chip adds its Remaining: "one-time · $1,200
  Remaining". Hover or tap lists each clue: "Bank: Groceries ✓", "6 past matches ✓", "AI:
  Eating Out ✗".
- **✓** files as suggested and saves the answer.
- **The chip** opens a popover: a grouped Category picker, an Expense picker filtered to it
  (`category-expense-link`), and **Save as rule**. Ticking it shows a prefilled rule (rare
  words; the amount for a fixed bill), editable: words, amount (none, exact, range),
  account (any, one). With a rule: "Also file 12 past rows that match", on by default.
- **Accept all strong (N)** acts on the current date filter, after a count confirmation. No
  rule option.
- Auto-filed rows show **Auto** with the reason on hover. **Undo** clears the filing, marks
  the row "never auto-file", returns it to To review and saves the answer.

**Rules page** (`/expenses/rules`, beside Categories in the nav)

- List: words, amount, account, → Expense or Category, "filed 34 rows", last used, saved
  by, on/off. The Household owns every Rule.
- Edit uses the popover's rule form. Saving offers "file N unfiled rows that match" and
  warns on overlap with another rule.
- Delete confirms and never unfiles rows.

Unchanged: the transaction form (except the grouped picker) and the Unplanned page.

## Error handling

| Case | Behaviour |
|---|---|
| Redbark category list fails | Sync continues; rows keep their bank category id; an unknown id is no clue until a later sync adds it |
| New bank category | Added unmapped; banner shows; no clue until placed |
| Bedrock error or throttle | Inngest retries the step; after the last retry the row keeps free clues; sync never blocks |
| AI returns an unknown id | Dropped; no clue; warning on the span |
| Daily AI cap reached | Free clues only; `filing-ai-backlog` picks the row up |
| Embedding fails for a row | Past matches fall back to word score with the 0.55 bar |
| Member files a row mid-run | Engine write applies only if still unfiled; the Member wins; suggestion removed |
| Expense or Category deleted | Suggestions and rules pointing at it cascade; the Rules page warns first; Category delete still blocked while an Expense uses it |
| Category deleted with mapped bank categories | They become unmapped; banner shows |
| Rules tie on specificity | Newest wins; save warns on overlap |
| Migration finds an old Category in use | Restrict fails; migration rolls back; prod untouched |
| Engine misbehaves at scale | `FILING_AUTO_ENABLED=false` stops auto-filing; suggestions still show |

## Testing

- **Unit** (`src/domain/filing/`, synthetic text): rule match and specificity; exact repeat
  (3 rows, same amount or rare word, one differing row blocks); past-match vote at 60%;
  strength levels; Expense picked only inside the winning Category; prompt builder; bank
  category name auto-map; Redbark DTO and mapper with the 4 fields (`redbark.fixtures.ts`).
- **Service** (fakes for transactions, expenses, categories and the classifier): AI only on
  Weak, Split or None within 12 months; daily cap holds; write only if unfiled; undo blocks
  re-filing; rule save files unfiled rows only.
- **Guards**: `src/server/architecture.test.ts` passes with an empty `TODO`; the Inngest
  registry golden test lists the 3 new functions.
- **Eval**: PostHog dataset `filing-suggestions`, promoted from `filing_answer`.
  `filing.eval.ts` reports each clue's precision and coverage, and Strong precision, with
  floors. No real text in the repo or CI.
- **Dashboard**: accept rate per clue, AI calls per day, cost per day.
- **Manual**: on the Neon branch, run the migration and catch-up, then accept, change, save
  as rule, undo and bulk accept in the browser.

## Build order

One ticket each:

1. Groups and Categories migration, new Categories page.
2. Bank fields on sync, bank category list, map UI.
3. Catch-up: history refresh, embed history, Old groups card.
4. Rules and the Rules page.
5. Engine without AI, To review, Auto tag and undo.
6. AI tie-break: spike, model, prices, IAM, cap, backlog cron.
7. Answers, PostHog event, dashboard, eval.

## Later (build on evidence only)

- Drop the old Group column, form field, search text and dashboard "Top groups" once To
  review is clear.
- Auto-file Strong suggestions once the eval shows Strong precision ≥ 98%.
- #111 note: "filed under the Transfers group" could serve as a hand-marked transfer or
  catch pairs more than 3 days apart.
- Batch several rows per AI call.
- pgvector index for past matches past about 50k filed rows.
- Compare Haiku 4.5, Haiku 5.5, Sonnet and Jev against the golden set.
- A matched Receipt's line-item Categories as one more Clue.

## Rejected

- **Live mirror of Redbark's list**: ties our Categories to a vendor and blocks rename,
  merge and split.
- **Merge old and new Categories**: leaves two overlapping lists.
- **Auto-file on Strong now**: no proof yet; one wrong filing hides real spend.
- **AI on every row**: costs more and breaks "AI only for ties".
- **No AI**: Split rows get no tie-break.
- **LLM self-confidence as the score**: overconfident; agreement between clues is more honest.
- **Jev**: not on Bedrock, no Australian region (adr014).
- **Sonnet as the tie-break model**: about 10× the cost of Haiku per row.
- **Compute suggestions on read**: slow pages and AI cost per view.
- **Nightly batch only**: new rows wait up to a day.
- **Expense from history only**: almost no Expense picks until many are linked by hand.
- **Separate review inbox page**: a new page to build; the Transactions table already fits.
- **Unplanned page only**: Spend only, so Inflow and transfers never get a Category.
- **Drag bank codes between Categories**: the API doesn't return sub-codes.
- **"Refresh from Redbark" button**: each sync refreshes the list.
- **pgvector search now**: needs cleaned text stored per row and splits scoring across SQL
  and app code.
- **Rename the old Group to "Label"**: it retires instead.
- **Rules in the Categories fold-out or Settings**: hard to find, especially rules that file
  to an Expense.
- **Exclude Transfers from Spend here**: mixes two features; #111 owns it.

## Related ADRs

- [adr030](../../docs/adr/adr030-copy-bank-category-list-once-keep-bank-category-as-a-clue.md): copy the bank feed's category list once; keep the Bank category as a mapped Clue (Proposed)
- [adr031](../../docs/adr/adr031-auto-file-only-by-rules-and-repeats-rank-by-clue-agreement.md): auto-file only by Rules and exact repeats; rank by Clue agreement; AI breaks ties (Proposed)
