---
status: living
last-updated: 2026-11-02
related-adrs: [adr017, adr022, adr029]
related-design: thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md
related-epic: none
related-issues: [108]
related-prs: [120, 126]
---

# History import

> Pick a date range, and Ledger brings in your older bank history, up to 7 years back, without making copies of rows you already have.

## User value

The daily bank sync only reaches back about 14 days. Anything older stays missing unless someone types it in. This page fills the gap in one run, and you can run it again safely.

**Who it's for**: a household member who linked a bank through RedBark and wants older history in Ledger.
**Problem it solves**: older bank rows are missing, and many of them were already typed in by hand or made from receipts, so a plain copy would double them.
**Outcome they get**: Ledger adds the missing bank rows. When a bank row has the same day and amount as one of yours and the descriptions clearly match, Ledger joins it to your row. Close calls wait on the page for your answer. Nothing is deleted.
**Out of scope**: picking which accounts to import (the run includes every live, syncable account); stopping a run partway; more than 7 years back; ranges ending after today; alerts or PostHog events for imports (see Operations).

## Design

**Lives in**:
- `src/app/(dashboard)/transactions/import/page.tsx` — the route; prefetches `latestImport` and `possibleDuplicates`.
- `src/app/(dashboard)/transactions/import/_components/import-view.tsx` — layout; polls `latestImport` every 3 s while a run is active and refreshes transaction queries when it ends.
- `src/app/(dashboard)/transactions/import/_components/import-form.tsx` — the From / To form; locked while a run is active.
- `src/app/(dashboard)/transactions/import/_components/import-status.tsx` — the Latest import card: status, range, counts, failure reason.
- `src/app/(dashboard)/transactions/import/_components/possible-duplicate-list.tsx` + `possible-duplicate-piles.tsx` — the To review list: two piles of your row beside the bank's, with the gaps marked, three answers per row, and one Apply.
- `src/app/(dashboard)/transactions/import/_components/import.display.ts` — status labels, counts, the range line, the gap chips.
- `src/app/(dashboard)/transactions/_components/transactions-view.tsx` — the "Import from bank" header button and its pending-review badge.
- `src/domain/cdr/import-range.ts` — `importWindows` (90-day windows), `IMPORT_MAX_YEARS`, `importEarliestDay`, `importRangeError` (the form and `startImport` both call it).
- `src/server/cdr/cdr.service.ts` — `startImport` (range checks, one active run) and `latestImport` (adds `active`).
- `src/server/cdr/cdr-sync.service.ts` — `claimImport`, `planImport`, `importChunk`, `finishImport`, `failImport`.
- `src/server/cdr/cdr.inngest.controller.ts` — the `cdr-import` function and its `onFailure`.
- `src/server/cdr/cdr.schema.ts` — the `cdr_import` table (migration `0024`).
- `src/server/transactions/transaction-reconcile.service.ts` — `reconcileSynced`: reads known ids, reviews and candidates, plans, then applies (shared with `cdr-sync`).
- `src/server/transactions/transactions.repository.ts` — `applyReconcile` (shared with `cdr-sync`) and the three resolve writes.
- `src/domain/transactions/reconcile-synced.ts` — `planReconcile`: known, adopt, flag or add, per bank row.
- `src/domain/transactions/description-score.ts` — cleans descriptions, scores words and meaning, holds the Adopt bars (adr029).
- `src/server/transactions/transactions.schema.ts` — `possible_duplicate.descriptionScore` (migration `0026`) and the `description_embedding` cache (`0027` turns on pgvector, `0028` adds the table).
- `src/server/inngest/functions.ts` — binds the reconcile to Bedrock (`BEDROCK_EMBEDDING_MODEL`).

**Choice made**: a background Inngest job split into one step per account per 90-day window. Each step reconciles its rows the same way the daily sync does. Counts add up on the `cdr_import` row, and the page polls that row.
**Rejected alternatives**: fetching inside the request (7 years won't fit in a page load, and RedBark caps one read at 5,000 rows); one big step (a retry would redo the whole import).
**Trade-offs**:
- `cdr-import` and `cdr-sync` share one concurrency slot (`"cdr-sync"`). The slot limits steps, not whole runs, so a daily sync can slip in between import steps. That's safe: two reconciles never run at once, and each one only adds what's missing.
- `flagged` is the change in pending reviews, not the number made. Joining a bank row to your row can close a review an earlier step opened, so a run's total can go below 0. The page shows it as 0 at the lowest.
- A queued or running row older than 24 hours counts as not active, so a run that died without reaching `onFailure` can't block the form forever.
- The form and `startImport` share one range check, `importRangeError`, so they refuse the same ranges with the same words.
- A chunk with any pair reads every distinct description once, to weigh words by how rare they are, and embeds only descriptions not yet cached. A chunk with no pair skips both.

### Scoring (adr029)

A same-day, same-amount pair Adopts only when its descriptions match. `description-score.ts` decides:

- **Clean first.** Drop processor prefixes (`PAYPAL *`, `SQ *`, …), place and card-suffix words (`AUS`, `QLD`, `Card`, `Value date`), dates, words with 3 or more digits, and the bank's `FRGN AMT: …` ending. Both scores and the embedding cache use the cleaned text.
- **Word score.** Cosine over shared words, each weighted by how rare it is across your saved descriptions plus the incoming rows.
- **Meaning score.** Cosine of two Titan V2 embeddings, cached in `description_embedding` by model and cleaned text.
- **Adopt** needs word ≥ `ADOPT_WORD_SCORE` and meaning ≥ `ADOPT_MEANING_SCORE`. With no meaning score, nothing Adopts.
- **Merged score** is the mean of both, or the word score alone when meaning is missing. It picks the partner (highest, then nearest day). Each new review saves it, and the page piles by it: `SIMILAR_SCORE` or more is Similar.

adr029 item 8 holds the full cleaning list and the tuning behind the cut-offs.

**Rejected**: words alone (it can't tell that "Woolies" means "WOOLWORTHS"); meaning alone (shared noise such as "PAYPAL … AUS" makes two subscriptions read alike, and a Bedrock outage leaves nothing to fall back on).

### Operations

**Health signals**: the Latest import card (status, counts, reason), the `cdr_import` row, and these log lines: `cdr import already claimed`, `cdr import skipped an account`, `embedding unavailable`, plus the RedBark errors from the shared sync code.
**Alerts**: *None yet. A failed run only shows on the page and in the logs. There's a `TODO(observability)` in `import-form.tsx`.*
**Failure modes & fallback**:
- `REDBARK_API_KEY` unset → the row reads Failed: "Bank sync isn't set up".
- RedBark 429 or 5xx → the step retries (3 retries) and honours `Retry-After` up to 1 hour. Asked to wait longer, it fails instead.
- Out of retries, or a non-retryable error → `onFailure` (`cdr-import-failure`) saves the reason. The card shows Failed with that reason, plus any counts so far.
- More than 997 chunks → fails with "This import is too big for one run. Try a shorter range."
- Run lost (cancelled in Inngest, or `failImport` hit a DB blip) → the card reads "Didn't finish" after 24 hours, and the form opens again.
- An account RedBark can't sync right now → the job skips and logs it, then imports the rest.
- Bedrock down or no AWS creds → logs `embedding unavailable`. A pair with an uncached description scores on words alone, so it is flagged, never adopted. It stays a review for you to answer: a later run refreshes a review but never rescores it.

**Flags / env vars**: `REDBARK_API_KEY`, `BEDROCK_EMBEDDING_MODEL` (both optional; see `docs/README.md`).

## Flow

**Triggers**:
- UI: the Import button on `/transactions/import` → `cdr.startImport`.
- Event: `cdr/import.requested` (sent through the outbox in the same transaction as the new `cdr_import` row) → Inngest `cdr-import`.
- UI: Apply on the To review list → `transaction.applyAnswers`, which saves every Answer and hands them to a background job ([Duplicate Apply](async-duplicate-apply.md)).

**Data path**: `startImport` saves the picked range as a `cdr_import` row plus an outbox event. The job splits the range into account × 90-day chunks, reads each from RedBark, and reconciles the rows into `transaction` and `possible_duplicate`. Each chunk adds its counts to the row, which the page polls.

```mermaid
sequenceDiagram
    participant M as Member
    participant App as Next.js (tRPC)
    participant DB as Neon
    participant Job as Inngest cdr-import
    participant RB as RedBark
    participant Bedrock as Bedrock (Titan)

    M->>App: cdr.startImport({ from, to })
    App->>App: range checks, no active run
    App->>DB: insert cdr_import (queued) + outbox event
    App-->>M: ok, card polls latestImport
    DB-->>Job: cdr/import.requested { importId }
    Job->>DB: claimImport: mark running
    Job->>RB: list accounts + connections
    loop each account × 90-day window
        Job->>RB: listTransactions(account, from, to)
        RB-->>Job: bank rows
        opt a bank row pairs with one of yours
            Job->>DB: read descriptions + cached embeddings
            loop each 32 cache misses, one 30 s limit for all
                Job->>Bedrock: embedMany(batch)
                Job->>DB: save batch
            end
        end
        Job->>DB: applyReconcile (add / adopt / flag / known)
        Job->>DB: add counts to cdr_import
    end
    Job->>DB: finishImport: running → done
    M->>App: applyAnswers(answers)
    App->>DB: save Answers, then a background job applies them (see Duplicate Apply)
```

**State transitions** (`cdr_import.status`):

```mermaid
stateDiagram-v2
    [*] --> queued: startImport
    queued --> running: claimImport
    queued --> failed: onFailure
    running --> done: finishImport
    running --> failed: no API key / onFailure
```

"Didn't finish" is computed at read time, not stored: a queued or running row older than 24 hours.

**What each bank row becomes** (`planReconcile`):
- **Already here** (`known`): the bank id is already in Ledger or waiting in a review, or a member already chose Keep mine on it. Ledger refreshes the row or review instead of doubling it.
- **Matched to yours** (`adopted`): same household day and same amount as a row you made, and the descriptions match in both words and meaning. Your row takes the bank's id, date and amount, but keeps your description and edits. If that row was waiting in a review, the review closes and Ledger adds its bank row.
- **Flagged** (`flagged`): the same amount as a row you made within 7 days, but not a match: another day, or the same day with descriptions that don't match closely enough. A near amount is added, not flagged: a real copy keeps its amount. A `possible_duplicate` waits on the page.
- **Added**: no match. Added as a new bank row.

When a bank row could pair with more than one of yours, the pair whose descriptions score highest wins, then the nearest day. The score mixes shared rare words with meaning (adr029). Each new review saves its score.

**Review answers**:
- **Keep mine**: drops the bank's copy.
- **Use bank's**: your row takes the bank's date and amount, and keeps your description, category, expense and receipt. Any other review on your row becomes its own row: your row is now that bank copy, so the other is a second purchase. (A row gets a second review when, after a close one, its same-day bank copy lands short of an Adopt, or a Similar copy a day or more off lands while none of its reviews is Similar. Accounts sync in any order, so the real copy can come second.)
- **Both are real**: adds the bank's row too.

Reviews sit in two piles:
- **Similar description**: a saved description score of 0.59 (`SIMILAR_SCORE`) or more. A review flagged before adr029 has no score, so it needs 3 or more shared words instead: a word is any run of letters or digits, case-blind, counted once. Its fill button picks **Use bank's**.
- **Different description**: the rest. Its fill button picks **Both are real**.

A fill only answers rows with no answer yet. **Apply** sends every answer at once. A background job applies them while a toast shows progress ([Duplicate Apply](async-duplicate-apply.md)).

**Edge cases**:
- Ranges that run past 7 years or after today, or a From after the To → stopped in the form, and again by the server with the same words.
- Starting while a run is active → the form locks and says why; the server returns a `CONFLICT` "An import is already running."
- The same review answered in another tab → the finish toast counts it as no longer needing an answer.
- A repeat event delivery → `claimImport` finds the row finished and runs nothing. A retried claim finds its own `running` row and carries on.

**Side effects**: inserts into `transaction` and `possible_duplicate`; updates your rows on adopt and Use bank's. Never moves the daily sync's cursor and never writes a balance anchor. Never deletes a transaction.

## Links

- ADRs: [adr017 — external transaction sync via CDR (RedBark)](../adr/adr017-external-transaction-sync-via-cdr-redbark.md), [adr022 — cross-domain data through the owning service](../adr/adr022-cross-domain-data-through-the-owning-service.md), [adr029 — pair bank rows by word and meaning scores](../adr/adr029-pair-bank-rows-by-word-and-meaning-scores.md)
- Design: [Expense linking, receipts and cash flow](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md) (build stage 7)
- Related plans: [Stage 7: CDR via RedBark](../../thoughts/plans/2026-09-15-expense-linking-stage-7-cdr-redbark.md) (Phases 7–8), [adr029 description scores](../../thoughts/plans/2026-11-02-adr029-description-scores.md)
- GitHub issues: #108 (open follow-up: animate an answered review leaving To review)
- PRs: #120 (import page, job and duplicate review), #126 (adr029 description scores)
- Shipping commits: `e7c5107` (import page and job), `a9a8cd6` (net released reviews out of `flagged`), `8457e0f` + `ffd464e` (clean descriptions, word score), `1b1fbef` (score pairs, gate Adopts), `21876ed` (meaning score, embedding cache), `01afbf5` (pile by saved score), `4fc1d29` (strip `FRGN AMT`)

---
*Generated from interview on 2026-10-28; updated for adr029 on 2026-11-02. To regenerate, run `/document-feature history-import`.*
