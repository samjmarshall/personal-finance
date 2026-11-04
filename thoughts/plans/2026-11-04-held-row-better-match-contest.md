---
date: 2026-11-04
adrs: []
status: Done
---
# Let a better bank row contest a held household row Implementation Plan

## Context
The history import paired the household row "AD MURRUMBA DOWNS PTY MURRUMBA DO AUS" ($4,545, 19 Jan 2026) with the own-account transfer "Transfer To Samuel Marshall, CommBank App Dentist". Its real card copy (18 Jan) was then **added** as a new Transaction, so the Spend counts twice. 7 of the 8 pending Possible duplicates in prod are this same bug (reviews 1, 2, 8, 9, 10, 11, 15), and 7 card Spends are doubled (transactions 2870, 2893, 2876, 2883, 2872, 2879, 2873). Goal: the real copy is always offered for review, whatever order the accounts sync in, and the 7 doubled Spends get repaired.

## Current State
- `cdr-import` reconciles one account × 90-day window per Inngest step, in RedBark's account order (`src/server/cdr/cdr.inngest.controller.ts:70`, `src/server/cdr/cdr-sync.service.ts:203-219`, `:240-269`). Each step plans alone (`src/server/transactions/transaction-reconcile.service.ts:111-145`). So "highest merged score first" (`src/domain/transactions/reconcile-synced.ts:291-298`) only ranks pairs inside one account.
- In run `01M6JEB6ATNRMG7QSHYYW77TJ5`, CommBank Offset (`acct_4Z7D…`, has the transfer) ran 6th. The Altitude card (`acct_28uk…`, has AD MURRUMBA) ran last.
- The Offset step paired the transfer with row 588 on the same day and cent. It fell short of an Adopt (merged 0.04), so it became review 8 and row 588 became *held*.
- A held household row can be flagged again only by a **same-day** bank row (`canFlag`, `src/domain/transactions/reconcile-synced.ts:131-138`). The card copy was 1 day off (the card posted a day later), so `pairUp` dropped the pair (`:219`). The planner then added the card row (`:311-313`).
- `MatchCandidate` carries `heldBy` only (`src/domain/transactions/reconcile-synced.ts:47-59`), from `min(id)` of pending reviews (`src/server/transactions/transactions.repository.ts:355-363`). The review's `descriptionScore` is stored (`src/server/transactions/transactions.schema.ts:108-109`), null on pre-adr029 reviews.
- "Use bank's" already releases every other pending review on the row into a Transaction (`useBanks`, `src/server/transactions/transactions.repository.ts:545-557`; `takeReviewsOn`, `:634-641`). So once the right review exists, one click repairs the wrong one too.
- The import page piles a review under "Similar" when `descriptionScore >= SIMILAR_SCORE` (`src/app/(dashboard)/transactions/import/_components/import.display.ts:164`; `SIMILAR_SCORE = 0.59`, `src/domain/transactions/description-score.ts:25`).
- Dates are fine. 565 Altitude card rows adopted on the same day. The 1-day gaps are only rows where the card posted a day apart.
- Tests pin the old rule: `src/domain/transactions/reconcile-synced.test.ts:419` ("never flags a held row a second time") and `:511` ("skips a held row unless the bank row is on its day").

## Desired End State
- A held household row gets one more Possible duplicate from a bank row within 7 days when that pair's merged score is ≥ `SIMILAR_SCORE` **and** beats the row's best pending score.
- A weaker bank row on a held row is still added, and a same-day one still flags as today. Adopt still needs day gap 0.
- The outcome no longer depends on which account syncs first. A strong copy that arrives after a weak one is reviewed, not added.
- Prod has no doubled card Spends from this bug. Reviews 1, 2, 8, 9, 10, 11, 15 are answered, and their transfers are Transactions.

## Out of Scope
- Planning every account in one step. The daily `cdr-sync` has the same "first arrival wins" shape, so the contest rule is the fix for both.
- Auto-releasing the weaker review when a stronger one lands. The Member still decides; "Use bank's" releases it.
- Spotting own-account transfers as a category of their own.
- Rescoring old reviews.

## Approach
Give each `MatchCandidate` the best merged score of its pending reviews (`heldScore`). `pairUp` lets a held household row through at any day gap within `MATCH_DAYS`, because the score isn't known until after pairing. `planReconcile` drops a held pair that is a day or more off unless its score clears `SIMILAR_SCORE` and beats `heldScore` (null counts as 0). Then the existing one-to-one Adopt/flag loops run unchanged. After deploy, the doubled rows are deleted and re-imported, so each card row comes back as a "Similar" review that "Use bank's" answers.

## Phase 1: Contest rule
### Changes
- `src/domain/transactions/reconcile-synced.ts`
  - `MatchCandidate` (`:47-59`): add `heldScore: number | null`. Doc: best merged score of its pending reviews; null when none or every one is pre-adr029.
  - `canFlag` (`:131-138`): a household row passes whether held or not. The retired-account branch is unchanged. Rewrite the rule comment above `canAdopt` (`:122-125`) to say a held row is flagged again by a same-day row, or by a closer-worded row a day or more off.
  - `planReconcile` (`:243-253`): right after scoring, keep a held pair only when `dayGap === 0 || (merged >= SIMILAR_SCORE && merged > (heldScore ?? 0))`. Import `SIMILAR_SCORE` from `./description-score`. Update the JSDoc (`:236-242`) to match.
- `src/server/transactions/transactions.repository.ts:355-374` — `held` subquery adds `max(possibleDuplicates.descriptionScore).as("heldScore")`; select `heldScore: held.heldScore`.
- `src/server/transactions/transactions.repository.test.ts:540-576` — harness row gains a score column. Expect `heldScore` on the result, and update the inline SQL snapshot.
- `src/domain/transactions/reconcile-synced.test.ts` — TDD, one test → one change (`tdd` skill):
  - `mine()` fixture (`:44-62`) gains `heldScore: null`.
  - Replace `:419` with: a held row (`heldScore: 0.04`) a day off from a same-words bank row → flagged, not added.
  - New: the same held row against a day-off bank row scoring below `SIMILAR_SCORE` → added.
  - New: a held row with `heldScore` at or above the new pair's score, a day off → added.
  - New: the real case as two plans in sequence (transfer step, then card step, with the candidate held after the first), and in reverse order → both end with the card row flagged on the household row.
  - Replace `matchPairs` test `:510-523`: a held household row now pairs at any day gap within 7. Update its comment (an embedding per pair is the cost).
- `src/server/transactions/transaction-reconcile.service.test.ts:100-108` — `mine()` fixture gains `heldScore: null`.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] Replaying the AD MURRUMBA case in either account order gives a flag on the household row with merged score ≥ 0.59, and no added card row

## Phase 2: Record the rule
### Changes
- `docs/adr/adr029-pair-bank-rows-by-word-and-meaning-scores.md:84-92` — one Negative Consequences bullet: a held row can collect a second review from a closer-worded row a day or more off (one more click); a weaker one is still added.
- `CONTEXT.md:156-160` (Possible duplicate) — check the wording still holds. It says "within 7 days, but not an Adopt", so it likely needs no edit. `CONTEXT.md` has uncommitted Member edits: touch only that entry, if at all.

### Success
- [x] `make check` passes
- [x] adr029 names the contest rule; `CONTEXT.md` has no stale line

## Phase 3: Repair the doubled Spends
### Changes
No code. Data steps, first on a branch, then prod.
- **Branch dry run.** Use a linked worktree, so Neon `local/<branch>` copies prod; `make db_branch_status` must show `*`. Run `make start` (app + Inngest dev).
  - Delete Transactions 2870, 2893, 2876, 2883, 2872, 2879, 2873 (`TransactionsRepository.delete`, `src/server/transactions/transactions.repository.ts:784`). They hold no reviews, and no tombstone stops a re-import.
  - From `https://<branch>.personal-finance.localhost/transactions/import`, import 2026-01-01 → 2026-03-31.
  - Expect 7 new reviews in "Similar" (AD MURRUMBA, IREMIA RECOVERY, SQ \*EARTH MOSS TWINE, PAYPAL \*BOOKINGCOMA, ATO Payment, 99 Bikes, CRED VOUCHER PAYPAL \*AIRBNBPAYME), each on the same household row as its wrong review.
  - "Use bank's" on each → the household row takes the bank id. Its transfer review (1, 2, 8, 9, 10, 11, 15) is released into a Transaction.
- **Prod.** After deploy, the Member does the same delete, re-import and "Use bank's" ×7 on `main`. Confirm with the Member before any prod write.

### Success
- [x] Branch: 7 "Similar" reviews appear after re-import, and the Westpac "WITHDRAWAL MOBILE … TFR Altitude Ve" rows are not re-flagged
- [x] Branch: after "Use bank's" ×7, no pending review has a merged score < 0.59 on rows 403, 406, 562, 570, 576, 580, 588
- [ ] Prod: the same two checks hold, and the read-only query shows one `AD MURRUMBA DOWNS` $4,545 Transaction, not two

## References
- ADRs: `docs/adr/adr029-pair-bank-rows-by-word-and-meaning-scores.md` (Accepted) — rule refined by Phase 1, recorded in Phase 2; `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md:52` (In Progress) — Possible duplicate facet
- Prior plan: `thoughts/plans/2026-11-02-adr029-description-scores.md`
- Prior fix that added the same-day re-flag: commit `4a92caa`
- Evidence: Inngest run `01M6JEB6ATNRMG7QSHYYW77TJ5` (chunk order); RedBark `search_transactions` 2026-01-10 → 2026-01-28, ≥ $4,545; prod `possible_duplicate` review 8 (`transactionId` 588, score 0.038, created 2026-11-03T08:18:01Z) vs Transaction 2876 (created 08:19:58Z)
