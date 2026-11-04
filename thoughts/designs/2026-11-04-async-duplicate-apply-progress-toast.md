# Async duplicate apply with a progress toast

Date: 2026-11-04
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr002 (outbox), adr004 (3-tier), adr017 (CDR sync), adr029 (description scores), adr032 (this design)
Precedent: `cdr-import` (`src/server/cdr/cdr.inngest.controller.ts`, `latestImport` polling in `import-view.tsx`)

## Problem

Apply on the Import page's "To review" list blocks the page while it runs.

- `possible-duplicate-list.tsx` loops in the browser, one 200-answer `resolveDuplicates` call
  after another. Each Answer makes 1–4 DB writes, so a big batch takes a while.
- A reload or dropped connection kills the loop. Answers that landed stay, but the tally is
  lost, and nothing shows where it stopped.
- The Member waits instead of moving on.

Goal: click Apply, get a toast with a progress bar at once, carry on elsewhere in the app, and
always be able to see whether and where an Apply stopped. It still works through the Answers in
order.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | A server job: an Apply row, an outbox event and an Inngest worker. The client polls the row. | A browser loop in a global store (dies on reload). Inngest Realtime push (developer preview, at-most-once, still needs the row). |
| 2 | Each Answer lives on its review row (`apply_id`, `choice`). | Answers as JSON on the Apply row. A separate `apply_answer` table. |
| 3 | Rows in a running Apply leave the list and the counts. | Locked rows in place. An "Applying" pile. |
| 4 | One Apply at a time. The server refuses a second. | A queue. Joining the running Apply. |
| 5 | One Inngest step per batch of 50. | One step for the whole Apply (timeout risk). A step per Answer (overhead, 1,000-step cap). |
| 6 | The worker gets its own concurrency slot, not `"cdr-sync"`. | Sharing it, which leaves the toast at 0 behind a long import. |
| 7 | On failure, the toast says where it stopped. Leftover rows return with their picks and a "Didn't apply" note. | A Retry button in the toast. Clearing the picks. |
| 8 | A watcher in the dashboard layout owns the toast. | A toast on the Import page only. A sessionStorage flag. |
| 9 | The Member can close the toast while it runs. | A toast that can't be closed. |
| 10 | Stuck means no progress for 15 minutes. One Apply takes up to 10,000 Answers. | Stuck by age since start, which fails a big Apply that is still working. A 1,000 cap with a second Apply for the rest. |

Verified facts:

- "Use bank's" and "Both are real" delete the review row. "Use bank's" also deletes every other
  pending review on the same Transaction (`takeReviewsOn`) and adds each one's bank row as a new
  Transaction. Bank sync releases pending reviews the same way. Rows can vanish mid-Apply without
  their own Answer running.
- So Answer order matters on a shared Transaction. "Use bank's" on B before "Keep mine" on A
  adds A's bank row, the opposite of A's Answer. Today the list order decides.
- Every resolve and every reconcile write is guarded on `status = pending`. Today's browser Apply
  already runs alongside `cdr-sync` and `cdr-import` under the same guards.
- Inngest Realtime ships in `inngest` v4 but is a developer preview with at-most-once delivery
  and no documented replay on reconnect.
- sonner's `toast(…, { id })` upserts in place. Its docs don't show a `toast.custom` toast
  turning into `toast.success` under the same id, so verify that during the build.
- Inngest retries back off with jitter. Its docs give no delays; the server source
  ([backoff.go](https://raw.githubusercontent.com/inngest/inngest/main/pkg/backoff/backoff.go))
  starts 15 s, 30 s, 1 m, each plus up to 30 s. So 3 retries on one step wait about 2–3 minutes,
  well inside the 15-minute no-progress rule. Reading the table from index 0 is inferred, not
  documented.

## Data

**New table `duplicate_apply`** (`src/server/transactions/transactions.schema.ts`)

| Column | Notes |
|---|---|
| `id` | identity PK |
| `status` | enum `running \| done \| failed` |
| `total` | Answers sent |
| `resolved`, `taken` | bumped in the same transaction as each Answer, so they're exact |
| `gone` | set at finish: `total − resolved − taken` |
| `error` | text, set on failure |
| `createdAt`, `updatedAt`, `finishedAt` | timestamps. `updatedAt` moves with every `resolved` or `taken` bump. |

- Partial unique index: at most one `running` row. This enforces decision 4 in the DB.

**New columns on `possible_duplicate`**

- `apply_id`: FK to `duplicate_apply.id`, `on delete set null`, indexed.
- `choice`: the Answer enum (`keep_mine | use_bank | both_real`).

Row states:

- **In a running Apply:** pending, and `apply_id` points at a running, active Apply. Hidden.
- **Didn't apply:** pending, and `apply_id` points at a failed or stuck Apply. Shown with its
  `choice` filled in and a "Didn't apply" badge.

**Stuck rule:** a `running` Apply whose `updatedAt` is over 15 minutes old reads as inactive. Every
Answer moves `updatedAt`, so a big Apply that is still working never trips it. Each worker batch
takes only rows whose Apply is still `running`, so a late worker does nothing once `start` has
failed it.

**Removed:** the `resolveDuplicates` mutation, the browser loop and the 200-per-call split.
`applyAnswersDto` takes 1–10,000 Answers with unique ids. The cap comes from Postgres: the
stamping query must stay under its 65,534 bind-value limit. **Kept:** the per-Answer writes
(`keepMine`, `useBanks`, `bothReal`), with a unique-key clash counted as taken.

## Server

**Tiers** (`.claude/rules/server-architecture.md`)

- `transactions.trpc.controller.ts`: `applyAnswers` → `ctx.services.duplicateApply.start(input)`;
  `currentApply` → `ctx.services.duplicateApply.current()`.
- `src/server/transactions/duplicate-apply.service.ts` (`DuplicateApplyService`): serves both
  tRPC and the worker. Its only dep is the transactions repository. It is a second service
  because a different caller needs different deps, as with `TransactionReconcileService`.
- `src/server/transactions/transactions.inngest.controller.ts`: declares `duplicate-apply`.
  Wired in `src/server/inngest/functions.ts`.
- `DrizzleTransactionsRepository` gains `outbox: OutboxWriteDoor`, like `DrizzleCdrRepository`.

**`start(answers)`**, one `outbox.commit` transaction:

1. Fail any stuck `running` Apply.
2. Insert `duplicate_apply` with `total = answers.length`.
3. Stamp `apply_id` and `choice` on each answered review that is pending and not in a running
   Apply. An unstamped Answer ends up in `gone`.
4. Emit `duplicate/apply.requested { applyId }`.

A clash on the partial unique index throws `ConflictError("An apply is already running.")`.

**Worker `duplicate-apply`**

- Retries 3. Concurrency `{ limit: 1, key: '"duplicate-apply"', scope: "env" }`. Trigger
  `duplicate/apply.requested`. `onFailure` → `service.fail(applyId, message)`.
- Loops `batch-0`, `batch-1`, … steps. Each calls `applyBatch(applyId)`: take up to 50 pending
  rows stamped with this Apply (Apply still `running`) and run each Answer.
  - Order: Keep mine, then Both are real, then Use bank's, then `id`. A Keep mine runs before
    any Use bank's can release its row. Both are real and a release both add the bank row, so
    their order doesn't matter.
  - Resolved: the Answer and `resolved + 1` (with `updatedAt`) commit in one transaction.
  - Taken: clear the row's `apply_id` and `choice`, and add 1 to `taken` (with `updatedAt`). The row returns blank,
    as it does today.
- The loop stops on a short batch. A `finish` step then sets `done`, `gone` and `finishedAt`,
  only when the Apply is still `running`.
- Batch size is one constant.

**`current()`** returns the latest Apply plus:

- `active`: `running`, with progress in the last 15 minutes.
- `remaining`: pending rows still stamped with it.

Progress is `total − remaining`.

`listPendingDuplicates` and `countPendingDuplicates` leave out rows in a running Apply. The review
DTO (`PossibleDuplicateReview`) gains `choice` and `notApplied`.

## Client

**`<ApplyProgress />`** (`src/app/(dashboard)/_components/apply-progress.tsx`, mounted in
`src/app/(dashboard)/layout.tsx`)

- `api.transaction.currentApply.useQuery()` with no Suspense, so it never holds up the page. It
  refetches every 2s only while `active`, and renders nothing itself.
- Running: `toast.custom(<ApplyToast …/>, { id: \`apply-${id}\`, duration: Infinity })`, upserted
  on each poll.
- Closed by the Member: remember the id in a ref and stop re-showing it for this Apply.
- Finished (only in a tab that saw it running):
  - All resolved: success, "200 answers applied", auto-close.
  - Some gone or taken: warning with `appliedLabel(tally)`, auto-close.
  - Failed or stuck: error, "Stopped at 120 of 200. 80 answers didn't apply.", one "Review"
    action → `/transactions/import`. No timer.
  - Then invalidate `transaction` and `expense.consumption`.
- A reload after the end shows no toast.

**`ApplyToast`**

- Title "Applying answers", a progress bar, "120 of 200" and a close button.
- The bar is `<div role="progressbar">` with an accessible name, `aria-valuenow`,
  `aria-valuemax` and `aria-valuetext="120 of 200"`. Its fill transition turns off under
  `motion-reduce`.
- Screen readers hear start and finish only, through a polite live region, never every tick.
- Fallback: if the same-id switch to `toast.success` fails, `ApplyToast` draws all four states.

**List and piles**

- `possible-duplicate-list.tsx`: one `applyAnswers.mutateAsync({ answers })`. On success it
  seeds the `currentApply` cache so the toast appears at once, then invalidates the review
  queries. On failure the `query-client.ts` error toast shows and the picks stay. The loop, the
  tally and the `applying` flag go.
- `possible-duplicate-piles.tsx`: while an Apply runs, the Apply button is disabled and reads
  "Applying 120 of 200…". Picking and filling stay live. `staged` starts from each row's saved
  `choice`. A `notApplied` row shows a "Didn't apply" badge.
- New copy in `import.display.ts`: `applyProgressLabel`, `applyStoppedLabel`.

## Errors and edge cases

| Case | Result |
|---|---|
| Submit fails (offline, 500) | One transaction, so nothing saved. Error toast; picks stay. |
| Submit while an Apply runs | `ConflictError` → "An apply is already running." |
| Review already gone at submit | Not stamped; counted `gone`. |
| Transient DB error in a batch | Inngest retries the step. Done Answers are no longer pending, so they're skipped and counts stay exact. |
| Step succeeded, result unrecorded | The batch re-runs; same skip. |
| Retries exhausted | `onFailure` → `failed` plus `error`. Leftovers show "Didn't apply". The watching tab gets the error toast. |
| Event never delivered | The outbox sweep re-sends it. After 15 minutes with no progress it reads as stuck, and the next `start` fails it. |
| Big Apply (10,000 Answers) | Every Answer moves `updatedAt`, so it never reads as stuck while it works. |
| Bank sync or import during an Apply | Guards on pending. A released review vanishes and counts as `gone`. |
| Transaction deleted mid-Apply | Its reviews cascade away and count as `gone`. |
| Two Use bank's on one Transaction | The lower `id` runs first and releases the other, whose bank row becomes a new Transaction. That Answer counts as `gone`. Nothing is lost. |
| Tab closed mid-Apply | The job keeps going. On reopen the toast returns if it's still running; otherwise the list shows the result. |
| Reload after a failure | No toast. The "Didn't apply" rows are the lasting record. |

- The worker throws, and `TracingMiddleware.onRunError` captures it. The service logs through its
  injected `logger` and never calls `captureException`.
- `duplicate_apply` rows are kept. No prune job.

## Testing

**Server** (colocated; no Postgres, no module mocks)

- `duplicate-apply.service.test.ts` (fake repository object literal):
  - `start` refuses while another Apply runs.
  - `gone` at submit.
  - Resolved and taken handling in a batch.
  - `finish` math.
  - Shared Transaction: A = Keep mine and B = Use bank's in one Apply. A is kept and its bank
    copy dropped, whatever the list order.
  - Two Use bank's on one Transaction: the lower `id` resolves, the other counts as `gone`.
  - `fail` touches only a `running` Apply.
  - `current().active` and the 15-minute no-progress rule: started 20 minutes ago but moved 1
    minute ago is active.
- `transactions.repository.test.ts` (`recordingDb()` snapshots):
  - `startApply` runs stuck→failed, insert, stamp and outbox row inside one `begin`/`commit`.
  - The batch query takes only rows of a `running` Apply, ordered Keep mine → Both are real →
    Use bank's → `id`.
  - Each Answer and its counter bump share one transaction.
  - List and count leave out rows in a running Apply.
- `transactions.inngest.controller.test.ts` (spy `createFunction`):
  - Frozen opts.
  - The batch loop stops on a short batch.
  - `finish` runs.
  - `onFailure` → `service.fail(applyId, message)`.
- `transactions.trpc.controller.test.ts`: both procedures route correctly, and `ConflictError` →
  `CONFLICT`.
- `registry-golden.test.ts`: pin `duplicate/apply.requested`, `duplicate-apply`,
  `duplicate-apply-failure` and the `"duplicate-apply"` key.
- `transaction.dto.test.ts`: `applyAnswersDto` takes 1–10,000 Answers and rejects repeat ids.
- Migration: `make db_generate`, then review the SQL (enum, table, columns, FK, both indexes),
  then `make db_migrate` on `local/<branch>`.

**Client** (Vitest + RTL)

- `apply-progress.test.tsx`:
  - The toast shows while running and updates in place.
  - Once closed it stays closed.
  - It turns into success, warning or error only after this tab saw it running.
  - It invalidates caches on finish.
  - A reload after the end shows no toast.
- `possible-duplicate-piles.test.tsx`:
  - The disabled "Applying x of y…" button.
  - Picking still works during an Apply.
  - A saved `choice` pre-fills the pick.
  - The "Didn't apply" badge.
- `import.display.test.ts`: the new labels.
- Accessibility: the progressbar has a name and `aria-valuetext`; only start and finish are
  announced.

**Manual:**

1. On a local branch, apply 300+ Answers.
2. Go to another page, then reload. The toast should come back.
3. Stop the Inngest dev server mid-Apply. Check the retries and the failed state.

## Related ADRs

- [adr032](../../docs/adr/adr032-apply-answers-as-a-background-job-stamped-on-the-review-row.md): Apply possible-duplicate Answers as a background job, stamped on the review row, with progress polled from Postgres (Proposed)
