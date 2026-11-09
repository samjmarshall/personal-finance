---
date: 2026-11-04
design: thoughts/designs/2026-11-04-async-duplicate-apply-progress-toast.md
adrs: [adr032]
status: Done
---
# Async Duplicate Apply with a Progress Toast Implementation Plan

## Context
Apply on the Import page's "To review" list runs a browser loop of 200-Answer `resolveDuplicates` calls. While it runs, the Member waits. A reload kills the loop and loses the tally, and nothing shows where it stopped. The goal: Apply starts a server job and returns at once. A toast anywhere in the dashboard shows progress, and a failed Apply leaves its Answers on the rows with a "Didn't apply" badge.

## Current State
- **Browser loop.** `possible-duplicate-list.tsx:43-79` slices Answers by `RESOLVE_DUPLICATES_MAX = 200` (`src/domain/transactions/transaction.dto.ts:88`). It awaits `resolveDuplicates` (`:22-24`) per slice and keeps the tally in memory. It toasts `appliedLabel(tally)` (`import.display.ts:207-234`) and holds an `applying` flag (`:26`).
- **Server resolve.** The tRPC `resolveDuplicates` (`src/server/transactions/transactions.trpc.controller.ts:45-49`) calls `TransactionsService.resolveDuplicates` (`transactions.service.ts:129-139`). That loops `resolveOne` (`:205-223`), which maps a unique violation to `taken` (`:217-222`).
- **Per-Answer writes.** `keepMine` (`transactions.repository.ts:535-543`) is one autocommit statement. `useBanks` (`:545-568`) and `bothReal` (`:570-581`) each open their own `db.transaction`. Every write is guarded on `isPending` (`:163-166`) through `takeReview` (`:623-631`). `takeReviewsOn` (`:634-641`) releases the Transaction's other pending reviews.
- **Answer type.** The Answer is a zod-only enum named `choice` (`transaction.dto.ts:80-83`). The client aliases it as `DuplicateChoice` (`import.display.ts:97`). `CONTEXT.md` says to avoid "choice", so this plan names it **`answer`** everywhere.
- **`possible_duplicate`.** The table is at `src/server/transactions/transactions.schema.ts:90-126` and has no `apply_id` or `answer`. The partial unique index precedent is `:69-71`. The pgEnum pattern is `:80-86`, built from TS enums in `src/lib/constants.ts:77-80`.
- **Review list.** `listPendingDuplicates` / `countPendingDuplicates` (`transactions.repository.ts:497-533`) filter on `isPending` only. `PossibleDuplicateReview` is at `src/domain/transactions/transaction.interface.ts:69-82`.
- **Repository deps.** `DrizzleTransactionsRepository` takes `{ db }` only (`transactions.repository.ts:171-180`). It is built at `transactions.module.ts:9` and `src/server/inngest/functions.ts:58`.
- **Job precedent (`cdr-import`).**
  - Repository: `DrizzleCdrRepository` takes `outbox: OutboxWriteDoor` (`src/server/cdr/cdr.repository.ts:67-79`). `insertImport` emits through `outbox.commit` (`:190-205`).
  - Worker: `src/server/cdr/cdr.inngest.controller.ts:12-88`, with its own concurrency slot, `onFailure` and step loop.
  - Busy guard: `ConflictError("An import is already running.")` (`src/server/cdr/cdr.service.ts:74-76`).
  - Polling: `latestImport` with a poll-while-active `refetchInterval` and a "saw it running" ref (`src/app/(dashboard)/transactions/import/_components/import-view.tsx:16-41`).
- **Wire names.** The registry is `src/server/inngest/events.ts:13-18`. `src/server/inngest/registry-golden.test.ts:13-20,25-66` pins event names, function ids and concurrency keys.
- **Toaster.** `<Toaster />` mounts in the root layout as a sibling *outside* `TRPCReactProvider` (`src/app/layout.tsx:44-47`). The dashboard layout is a server component (`src/app/(dashboard)/layout.tsx:10-24`).
- **sonner 2.0.8, checked in `node_modules/sonner/dist/index.mjs`:**
  - A same-id upsert merges data and keeps the old `jsx` (`:198-215`), and `jsx` wins over the title (`:860`). So a `toast.custom` toast can't become a `toast.success` toast, and the design's fallback applies: `ApplyToast` draws all four states.
  - A new `duration` restarts the close timer (`:528-531`, `:563-565`).
  - Custom toasts get no built-in close button (`:842`).
  - The toaster section is `aria-live="polite"` with `aria-relevant="additions text"` (`:1145-1147`), so any text change inside a toast is announced.
- **UI rules.**
  - `.claude/rules/ui-components.md`: `(dashboard)/_components/` serves the home page only. Group-wide components go in `src/components/`.
  - `.claude/rules/unit-testing.md`: test the props-driven child of a component that calls `api.*`.
  - No progress bar exists in `src/components/ui/`.
- **Branch.** This work is on `main`. There, `.env` points at production, so it must move to a branch before any migration.

## Desired End State
- Apply sends every Answer (up to 10,000) in one `applyAnswers` call. It returns within one request, and the rows leave the list and the counts at once.
- An Inngest `duplicate-apply` worker runs the Answers in batches of 50, in the order Keep mine → Both are real → Use bank's → `id`. `resolved` and `taken` are exact, and `gone = total − resolved − taken` at finish.
- A toast in every dashboard page shows "Applying answers", a progress bar and "120 of 200". It survives navigation and reload, and the Member can close it.
  - On finish, it turns into success, warning, or error. The error says "Stopped at 120 of 200. 80 answers didn't apply." and has a "Review" link.
- A second Apply while one runs gets "An apply is already running."
- A failed or stuck Apply (no progress for 15 minutes) leaves its rows pending, each with its saved `answer` pre-filled and a "Didn't apply" badge.
- `resolveDuplicates`, the browser loop and the 200 split are gone.

## Out of Scope
- A queue of Applies, or joining a running Apply (one at a time, adr032).
- Inngest Realtime push.
- A Retry button in the toast. Re-applying from the list is the only path.
- A toast in other tabs that never saw the Apply running.
- Pruning `duplicate_apply` rows.
- A shadcn `progress` primitive. The bar is a plain `div role="progressbar"`.

## Approach
Follow the `cdr-import` shape:
- The repository writes the Apply row, stamps each Answer on its review row, and adds the outbox event, all in one `outbox.commit`.
- `DuplicateApplyService` serves both tRPC and the worker.
- The Inngest worker loops `batch-N` steps until a short batch.
- The client polls `currentApply` every 2 s while active.

Each Answer and its counter bump share one DB transaction. A retried step skips Answers that are no longer pending, so the counts stay exact. Each Answer write is also guarded on `apply_id = this Apply`. A late worker from a stuck Apply then can't touch rows a newer Apply has re-stamped.

Phase 1 adds the data model and repository and leaves the old path working. Phase 2 adds the job and the tRPC procedures. Phase 3 switches the client and deletes the old path.

## Phase 1: Apply data model and repository
### Changes
**Docs**
- `docs/adr/adr032-apply-answers-as-a-background-job-stamped-on-the-review-row.md` (`:51`, `:59`, `:124`) and `thoughts/designs/2026-11-04-async-duplicate-apply-progress-toast.md` (`:27`, `:76`, `:82`, `:111`, `:127`, `:141`, `:178`, `:248`): rename the column `choice` → `answer`, per `CONTEXT.md` ("Answer… _Avoid_: choice").

**Enums and schema**
- `src/lib/constants.ts`, next to `PossibleDuplicateStatus` (`:77-80`):
  - Add `enum Answer { KeepMine = "keep_mine", UseBank = "use_bank", BothReal = "both_real" }`.
  - Add `enum DuplicateApplyStatus { Running = "running", Done = "done", Failed = "failed" }`.
- `src/server/transactions/transactions.schema.ts`:
  - Add the pgEnums `duplicate_answer` and `duplicate_apply_status`, in the pattern of `:80-86`.
  - Add a `duplicateApply` table (`duplicate_apply`) above `possibleDuplicates`:
    - `id` (identity)
    - `status` (not null, default `running`)
    - `total` (int, not null)
    - `resolved`, `taken`, `gone` (int, not null, default 0)
    - `error` (text)
    - `createdAt` (not null, default now)
    - `updatedAt` (not null, default now, `$onUpdate(() => new Date())`, so every counter bump moves it)
    - `finishedAt`
  - Add a partial unique index `duplicate_apply_running_idx` on `status` `.where(sql\`${t.status} = 'running'\`)`, in the pattern of `:69-71`.
  - `possibleDuplicates` (`:90-126`) gains:
    - `applyId`: int, `.references(() => duplicateApply.id, { onDelete: "set null" })`
    - `answer`: `duplicateAnswer()`, nullable
    - an index `possible_duplicate_apply_idx` on `applyId`
- `drizzle/0029_*.sql`: run `make db_generate`, then review the SQL. Expect 2 enums, the table, the partial unique index, 2 columns, an FK with `ON DELETE SET NULL`, and the `apply_id` index.

**Domain types and DTOs**
- `src/domain/transactions/transaction.interface.ts`:
  - `PossibleDuplicate` (`:44-58`) gains `answer: Answer | null` and `applyId: number | null`.
  - Add a `DuplicateApply` interface (the row).
  - Add `CurrentApply = DuplicateApply & { active: boolean; remaining: number }`, mirroring `LatestImport` (`src/domain/cdr/cdr.interface.ts:35`).
  - Export the new types from `src/domain/transactions/index.ts`.
  - Fix any `PossibleDuplicate` literal that the typecheck flags.
- `src/server/db/schema-interface-contract.test.ts`: add `_DuplicateApplyContract`, in the pattern of `:50-57`.
- `src/domain/transactions/transaction.dto.ts`:
  - Add `answerDto = z.object({ id: z.number().int().positive(), answer: z.enum(Answer) })`.
  - Add `APPLY_ANSWERS_MAX = 10_000`. Comment: the stamp uses 2 bind values per Answer, under Postgres's 65,534.
  - Add `applyAnswersDto`: `answers` is 1–`APPLY_ANSWERS_MAX`, with the unique-id refine of `:96-101`.
  - Add types `AnswerInput` and `ApplyAnswersInput`.
  - `resolveDuplicatesDto` stays until Phase 3.
- `src/domain/transactions/transaction.dto.test.ts`: add `describe("applyAnswersDto")`, in the pattern of `:302-329`. It accepts 10,000 Answers, and rejects 0, 10,001, a repeated id, and an unknown answer.

**Event**
- `src/server/inngest/events.ts:13-18`: add `"duplicate/apply.requested": z.object({ applyId: z.number().int() })`.
- `src/server/inngest/events.test.ts:95-103`: add the name to the `EventName` union.
- `src/server/inngest/registry-golden.test.ts:13-20`: add the name to the sorted key list.

**Repository** (`src/server/transactions/transactions.repository.ts`)
- Deps (`:171-180`) gain `outbox: OutboxWriteDoor`, mirroring `src/server/cdr/cdr.repository.ts:67-79`.
- Refactor `keepMine` / `useBanks` / `bothReal` / `takeReview` (`:535-581`, `:623-631`) into private helpers taking `(executor: Executor, id, applyId?)` (`Executor`, `:74-76`).
  - With `applyId`, the pending guard also requires `apply_id = applyId`. `takeReviewsOn` keeps its pending-only guard.
  - The public `keepMine` / `useBanks` / `bothReal` wrap the helpers unchanged until Phase 3. The "resolving a review" snapshots (`transactions.repository.test.ts:1029-1225`) must stay byte-identical. That is the characterization check for this refactor.
- New methods on the `TransactionsRepository` interface (`:105-…`):
  - `startApply(answers: AnswerInput[], staleBefore: Date): Promise<CurrentApply>`. One `outbox.commit` that:
    1. Fails any `running` Apply whose `updatedAt < staleBefore`: sets `failed`, `error = "No progress; failed by the next apply."` and `finishedAt`.
    2. Inserts `{ total: answers.length }` returning.
    3. Stamps `apply_id` and `answer` in one `UPDATE possible_duplicate … FROM (VALUES …)`, only where the row is pending and its `apply_id` is null or not a `running` Apply. Returns the ids it stamped.
    4. Emits `buildOutboxEvent("duplicate/apply.requested", { applyId })`.
    - Returns `{ ...row, active: true, remaining: stamped.length }`. A unique-index clash bubbles.
  - `takeApplyBatch(applyId, limit): Promise<AnswerInput[]>`. Selects pending rows stamped with `applyId` whose Apply is still `running`. Orders by `CASE answer WHEN 'keep_mine' THEN 0 WHEN 'both_real' THEN 1 ELSE 2 END, id`, with `LIMIT`.
  - `applyAnswer(applyId, answer: AnswerInput): Promise<boolean>`. One `db.transaction`: the Answer's helper with the `applyId` guard, then (only if it resolved) `resolved = resolved + 1` on the Apply. A unique violation rolls back both and bubbles.
  - `releaseAnswer(applyId, id): Promise<boolean>`. One transaction:
    - Clears `apply_id` and `answer` where `id`, `apply_id = applyId` and pending.
    - Only when a row matched, sets `taken = taken + 1`.
  - `finishApply(applyId)`: sets `done`, `gone = total − resolved − taken` and `finishedAt`, only where the Apply is `running`.
  - `failApply(applyId, error): Promise<boolean>`: sets `failed`, `error` and `finishedAt`, only where the Apply is `running`.
  - `latestApply(): Promise<(DuplicateApply & { remaining: number }) | undefined>`. The newest row by `id`, with a `count(*)::int` subquery of pending rows stamped with it.
- `src/server/transactions/transactions.module.ts:9` and `src/server/inngest/functions.ts:58`: pass `outbox: outboxService`. `outboxService` comes from `src/server/outbox/outbox.module.ts`.

**Tests**
- `src/server/transactions/transactions.repository.test.ts`. The harness (`:24-31`) gains the stand-in outbox door from `src/server/cdr/cdr.repository.test.ts:19-44` and returns `events`. Inline SQL snapshots for:
  - `startApply`: `begin` → stale-fail update → insert → stamp → `commit`. Emits `["duplicate/apply.requested", { applyId, _trace }]` and returns `remaining` = rows stamped. With `pgError("23505")` on the insert, it records `rollback` and rethrows.
  - `takeApplyBatch`: takes only rows of a `running` Apply, ordered Keep mine → Both are real → Use bank's → `id`, limited to 50.
  - `applyAnswer` for each answer: `begin`, then the write guarded on `apply_id`, then the counter bump, then `commit`. No bump and `false` when the row isn't pending. Use bank's with a unique violation records `rollback` and rethrows.
  - `releaseAnswer`: clears the stamp and bumps `taken` in one transaction. No bump when the row isn't stamped.
  - `finishApply` / `failApply`: guarded on `running`.
  - `latestApply`: has the `remaining` subquery, and returns `undefined` with no row.
- `src/server/transactions/transactions.service.test.ts:36-63`: add the 7 new methods to the fake as `unstaged`.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] The generated `drizzle/0029_*.sql` has both enums, the table, the partial unique index `WHERE status = 'running'`, both columns, the FK `ON DELETE SET NULL` and the `apply_id` index
- [x] `make db_branch_status` shows `*` on `local/<branch>`, then `make db_migrate` applies 0029
- [x] The existing "resolving a review" snapshots pass unchanged
- [ ] Apply on the Import page still works through the old path — n/a at validation: Phase 3 removed the old path; the new path was verified live instead
- [x] `/security-review` (touches `src/lib/constants.ts`)

## Phase 2: Background job and tRPC procedures
### Changes
**Service**
- `src/server/transactions/duplicate-apply.service.ts`: `DuplicateApplyService`. Implements adr032 (`docs/adr/adr032-apply-answers-as-a-background-job-stamped-on-the-review-row.md`).
  - Deps: `{ repository: DuplicateApplyRepository; logger: Logger }`. `DuplicateApplyRepository` is a `Pick<TransactionsRepository, …>` of the 7 Phase 1 methods, like `ReconcileRepository` (`transaction-reconcile.service.ts:45-54`).
  - Constants: `APPLY_BATCH = 50` and `APPLY_STALE_MS = 15 * 60_000`. Export `applyActiveSince(now = Date.now())`.
  - `start({ answers })`: calls `repository.startApply(answers, applyActiveSince())`. On `isPgViolation(error, PgViolation.UniqueViolation)` it throws `ConflictError("An apply is already running.", { cause })`, as in `src/server/cdr/cdr.service.ts:74-76`. Other errors bubble.
  - `applyBatch(applyId): Promise<{ more: boolean }>`:
    - Gets `takeApplyBatch(applyId, APPLY_BATCH)` and runs `applyAnswer` on each in the order given.
    - A unique violation → `releaseAnswer` (taken). Any other error rethrows.
    - Returns `more: batch.length === APPLY_BATCH`.
  - `finish(applyId)` → `finishApply`.
  - `fail(applyId, message)` → `failApply`, then logs `logger.error` with `{ applyId, message }`. It never calls `captureException`.
  - `current(): Promise<CurrentApply | null>`: `latestApply()` plus `active = status === Running && updatedAt > applyActiveSince()`.
- `src/server/transactions/duplicate-apply.service.test.ts`. A fake repository object literal plus a fake logger (rule: no module mocks). `vi.useFakeTimers({ toFake: ["Date"] })`. Cases:
  - `start` maps a unique violation to `ConflictError` "An apply is already running." and lets other errors bubble.
  - `start` passes `staleBefore` = now − 15 min.
  - `applyBatch` counts resolved through `applyAnswer`, treats `false` as gone, and calls `releaseAnswer` on a unique violation. Another error bubbles. `more` is true on 50 rows and false on 49.
  - Shared Transaction: a stateful in-memory fake where Use bank's on B deletes A if A is still pending. The batch [A Keep mine, B Use bank's] keeps A and doesn't release it. The service never reorders a batch.
  - Two Use bank's on one Transaction: the lower `id` resolves. The other's `applyAnswer` returns `false`, so it is counted `gone` at finish.
  - `fail` passes through and logs. The guard on `running` is the repository's.
  - `current()`: `null` with no row. Started 20 min ago and updated 1 min ago → `active`. Updated 16 min ago → not active. `done` → not active.

**Worker**
- `src/server/transactions/transactions.inngest.controller.ts`: `TransactionsInngestController`, mirroring `src/server/cdr/cdr.inngest.controller.ts:12-37,48-88`.
  - `RETRIES = 3`.
  - `APPLY_SLOT = { limit: 1, key: '"duplicate-apply"', scope: "env" } as const`.
  - `createFunction({ id: "duplicate-apply", retries, concurrency: APPLY_SLOT, triggers: [{ event: "duplicate/apply.requested" }], onFailure: ({ event, error }) => this.service.fail(event.data.event.data.applyId, error.message) }, …)`.
  - The handler reads `event.data.applyId` by name. It loops `step.run(\`batch-${n}\`, () => this.service.applyBatch(applyId))` until `!more`, then runs `step.run("finish", …)`.
  - `get functions()`.
- `src/server/transactions/transactions.inngest.controller.test.ts`, using the harness and `fakeStep` from `cdr.inngest.controller.test.ts:52-95`. Cases:
  - The frozen opts.
  - `more` = true, true, false gives steps `batch-0`, `batch-1`, `batch-2`, `finish`.
  - A replayed step doesn't re-run its batch (`:177-184` pattern).
  - `onFailure` calls `fail(7, "boom")`.
- `src/server/inngest/functions.ts`:
  - Build `DuplicateApplyService` with `new DrizzleTransactionsRepository({ db, outbox: outboxService })` and `createRootLogger().with({ domain: "transactions", component: "apply" })`.
  - Spread `TransactionsInngestController.functions` into `functions` (`:73-77`).
- `src/server/inngest/registry-golden.test.ts`:
  - Build the controller with the others (`:39-41`).
  - Pin `{ id: "duplicate-apply", concurrency: { limit: 1, key: '"duplicate-apply"', scope: "env" }, triggers: [{ event: "duplicate/apply.requested" }] }`.
- `.claude/rules/server-architecture.md` (FROZEN external identifiers): add `duplicate/apply.requested`, `duplicate-apply`, `duplicate-apply-failure` and the `"duplicate-apply"` key.

**tRPC**
- `src/server/api/services.ts:27-46`: add `duplicateApply: new DuplicateApplyService({ repository: new DrizzleTransactionsRepository({ db, outbox: outboxService }), logger: createRootLogger().with({ domain: "transactions", component: "apply" }) })`.
- `src/server/transactions/transactions.trpc.controller.ts` (next to `:37-49`):
  - `applyAnswers: protectedProcedure.input(applyAnswersDto).mutation(… ctx.services.duplicateApply.start(input))`
  - `currentApply: protectedProcedure.query(… ctx.services.duplicateApply.current())`
  - `resolveDuplicates` stays until Phase 3.
- `src/server/transactions/transactions.trpc.controller.test.ts`. `callerWith` (`:13-18`) also takes a `duplicateApply` fake. Cases:
  - Both procedures route with the parsed input.
  - A thrown `ConflictError` maps to `CONFLICT` "An apply is already running." (`src/server/cdr/cdr.trpc.controller.test.ts:122-136`).
  - A signed-out `applyAnswers` is refused before reaching the service.

**Hide rows in a running Apply**
- `transactions.repository.ts:497-533`:
  - `listPendingDuplicates(activeSince)` and `countPendingDuplicates(activeSince)` left join `duplicate_apply` on `apply_id`. They drop rows whose Apply is `running` with `updated_at > activeSince`.
  - The list also selects `answer` and `notApplied: sql<boolean>\`${possibleDuplicates.applyId} is not null\``. Any stamped row still in the list belongs to a failed or stuck Apply.
- `transaction.interface.ts:69-82`: `PossibleDuplicateReview` gains `answer: Answer | null` and `notApplied: boolean`.
- `transactions.service.ts:119-125`: `listPossibleDuplicates` and `possibleDuplicateCount` pass `applyActiveSince()`, imported from `./duplicate-apply.service`.
- Tests:
  - `transactions.repository.test.ts:953-1027`: new list and count snapshots with the join and filter, and a row with `answer` and `notApplied`.
  - `transactions.service.test.ts:219`: asserts the cutoff passed; the `REVIEW` fixture (`:200-217`) gains the 2 fields.
  - `possible-duplicate-piles.test.tsx:13-41`: the fixture gains `answer: null, notApplied: false`.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `registry-golden.test.ts` pins `duplicate/apply.requested`, `duplicate-apply` and the `"duplicate-apply"` key
- [x] On `local/<branch>` with the Inngest dev server running, `duplicate-apply` shows with concurrency key `"duplicate-apply"`
- [ ] Apply on the Import page still works through the old path, and its rows still show — n/a at validation: old path removed in Phase 3

## Phase 3: Progress toast and Import page switch
### Changes
**Toast** (in `src/components/`, because a group-wide component can't live in `(dashboard)/_components/`, per `.claude/rules/ui-components.md`)
- `src/components/apply-progress.display.ts`:
  - Move `appliedLabel` from `import.display.ts:207-234`, typed on `Pick<DuplicateApply, "resolved" | "gone" | "taken">`.
  - Add `applyProgressLabel({ total, remaining })` → "120 of 200" (done = `total − remaining`, `formatCount`).
  - Add `applyStoppedLabel({ total, remaining })` → "Stopped at 120 of 200. 80 answers didn't apply." ("1 answer didn't apply." when singular).
  - Add `applyOutcome(apply)`: `"error"` when `failed`, or when `running` and not `active`; `"warning"` when `gone` or `taken` > 0; otherwise `"success"`.
- `src/components/apply-progress.display.test.ts`: the moved `appliedLabel` cases (from `import.display.test.ts:238-256`) plus the 3 new functions.
- `src/components/apply-toast.tsx`: `ApplyToast`, props only (it renders inside `<Toaster />`, outside `TRPCReactProvider`). Props: `{ apply, phase: "running" | ApplyOutcome, onClose }`.
  - Running:
    - Title "Applying answers".
    - A `<div role="progressbar" aria-label="Applying answers" aria-valuemin={0} aria-valuenow={done} aria-valuemax={total} aria-valuetext="120 of 200">`. Its fill uses `transition-[width] motion-reduce:transition-none`.
    - The visible "120 of 200" is `aria-hidden`, so sonner's polite section (`index.mjs:1145-1147`) announces only the toast's arrival and the finish text, never each tick.
  - Success / warning: `appliedLabel`. Error: `applyStoppedLabel`, plus a "Review" `Link` to `/transactions/import`.
  - Every state has its own close button labelled "Close", since custom toasts get none (`index.mjs:842`).
- `src/components/apply-toast.test.tsx`:
  - The progressbar has its name, `aria-valuenow`, `aria-valuemax` and `aria-valuetext`, and the visible count is `aria-hidden`.
  - Each finish state shows its copy, and the error state links "Review" to `/transactions/import`.
  - Close calls `onClose`.
- `src/components/apply-progress.tsx` (`"use client"`):
  - `ApplyProgress`: `api.transaction.currentApply.useQuery(undefined, { refetchInterval: (q) => (q.state.data?.active ? 2000 : false) })`, with no Suspense, so it never holds up a page. It renders `<ApplyToasts apply={data ?? null} onFinished={…} />`. `onFinished` invalidates `utils.transaction` and `utils.expense.consumption`, as `import-view.tsx:33-36` does.
  - `ApplyToasts` (exported, props only, renders nothing) holds `seen` and `closed` refs:
    - **Active and not closed:** `toast.custom(() => <ApplyToast phase="running" …/>, { id: \`apply-${id}\`, duration: Infinity, onDismiss: () => { closed.current = id } })`, upserted on each poll.
    - **Finished:** only when `seen` holds this id as active. Calls `onFinished()` once, then `toast.custom(() => <ApplyToast phase={applyOutcome(apply)} …/>, { id, duration: error ? Infinity : 5000 })`.
      - Closing hides progress only. The finish toast still shows, so a failure always reaches the Member (design decision 7).
      - A new `duration` restarts the timer (`index.mjs:563-565`). A toast that was dismissed comes back fresh (`:189-194`).
    - A first render with a finished Apply shows nothing, so a reload after the end has no toast.
    - `currentApply` isn't prefetched, so the first toast lands after `<Toaster />` (a later sibling, `src/app/layout.tsx:45-46`) has subscribed.
- `src/components/apply-progress.test.tsx` renders sonner's `<Toaster theme="light" />` (no `matchMedia` needed) plus `<ApplyToasts>`, and uses `rerender`. Cases:
  - The running toast shows, and updates in place (one progressbar, new `aria-valuetext`).
  - Once closed, a later tick doesn't bring it back.
  - Success, warning and error appear only after this render saw the Apply running, and `onFinished` is called once.
  - A first render with a `done` Apply shows no toast and doesn't call `onFinished`.
  - Add a shim to `src/test/setup-dom.ts` only if a failing test proves it is needed.
- `src/app/(dashboard)/layout.tsx:20-21`: mount `<ApplyProgress />` next to `<main>`.

**Import page**
- `possible-duplicate-list.tsx`:
  - Replace the `resolveDuplicates` mutation, the `applying` state and the loop (`:22-26`, `:43-79`) with `applyAnswers.useMutation({ networkMode: "always" })`.
  - `apply(answers)`:
    - `mutateAsync({ answers })`.
    - Then `utils.transaction.currentApply.setData(undefined, apply)`, so the toast appears at once.
    - Then invalidate `possibleDuplicates` and `possibleDuplicateCount`, and return `true`.
    - On error it returns `false`. `query-client.ts:67-73` already shows the toast, and the picks stay.
  - Read `api.transaction.currentApply.useQuery()` (shared cache; `ApplyProgress` drives the poll). Pass the piles `sending={start.isPending}` and `progress={current?.active ? current : null}`.
  - The `onEmptied` focus logic (`:29-41`) stays.
- `possible-duplicate-piles.tsx`:
  - Props (`:29-39`): drop `applying`; add `sending: boolean` and `progress: Pick<CurrentApply, "total" | "remaining"> | null`.
  - `Staged` (`:27`) becomes `Partial<Record<number, Answer | null>>`. `null` means the Member cleared the pick. A missing key falls back to the row's saved `answer`.
    - `answers` (`:44-48`), `pick` (`:50-62`) and `fill` (`:64-74`, which fills only rows with no effective pick) read the effective pick.
    - Clear (`:134-143`) sets every shown row to `null`, so saved answers clear too.
  - Apply button (`:144-153`): `disabled={answers.length === 0 || progress !== null}` and `loading={sending}`. While `progress` is set, it reads `Applying ${applyProgressLabel(progress)}…`.
  - Fill (`:212-221`) and each row's `fieldset` (`:303-311`) stay live during an Apply. Only `sending` disables them.
  - `Row` (`:250-354`): when `notApplied`, show a "Didn't apply" warn pill (the style of `:289-295`) in the Answer cell.
- `import.display.ts`:
  - `DuplicateChoice` (`:97`) becomes the `Answer` enum, and `CHOICES` (`:100-117`) becomes `ANSWERS`, keyed by `Answer`.
  - Drop `appliedLabel` (moved).
- `possible-duplicate-piles.test.tsx`. `renderPiles` (`:59-78`) takes `sending` and `progress`. Replace the `applying` test (`:259-269`) with:
  - A disabled "Applying 120 of 200…" button.
  - Radios and fill stay enabled during an Apply.
  - A saved `answer` pre-fills the pick and counts in "n of m answered".
  - Clear blanks a saved answer.
  - A `notApplied` row shows "Didn't apply".
- `import.display.test.ts`: drop the moved `appliedLabel` cases (`:238-256`) and follow the `CHOICES` → `ANSWERS` rename.

**Delete the old path**
- `transactions.trpc.controller.ts:45-49`: delete `resolveDuplicates`, and its tests in `transactions.trpc.controller.test.ts:151-192`.
- `transactions.service.ts`: delete `resolveDuplicates` (`:129-139`) and `resolveOne` (`:205-223`), and their tests in `transactions.service.test.ts:229-303`.
- `transactions.repository.ts`: delete the public `keepMine` / `useBanks` / `bothReal` from the interface (`:113-116`) and the class wrappers, and their tests (`transactions.repository.test.ts:1029-1225`). The Phase 1 `applyAnswer` tests cover the same statements.
- `transaction.dto.ts:80-104`: delete `resolveDuplicateDto`, `RESOLVE_DUPLICATES_MAX` and `resolveDuplicatesDto`, and their tests (`transaction.dto.test.ts:302-329`).
- `transaction.interface.ts:84-90`: delete `ResolveDuplicatesResult`, and drop the barrel exports (`src/domain/transactions/index.ts:26-29,47,69-71,91-92`).

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `rg "resolveDuplicates|RESOLVE_DUPLICATES_MAX|DuplicateChoice" src` returns nothing
- [x] On `local/<branch>`, applying 300+ Answers returns at once, the rows leave the list, and the toast counts up to "300 of 300", then shows success
- [x] Going to another page and reloading mid-Apply brings the toast back
- [x] Closing the toast mid-Apply keeps it closed until the finish toast
- [ ] Stopping the Inngest dev server mid-Apply, then letting retries run out, shows the error toast "Stopped at x of y…" with "Review". The leftover rows show their saved answer and "Didn't apply" — verified via the stale path (worker killed, Apply backdated 16 min); the retries-exhausted `onFailure` path is unit-tested only. Re-validation 2026-11-05: still open; forcing a step failure needs DB fault injection on `local/<branch>`, which needs the owner. Re-validation 2026-11-08: still open (Inngest dev server off; a hook blocks `.env` reads, so no DB access for fault injection). Re-validation 2026-11-09: still open, same reason
- [x] A second Apply during a run shows "An apply is already running."
- [x] `/design-review` — first run 2026-11-05: 0 blockers, 1 High ("Didn't apply" not announced), fixed in 8278222 and confirmed. Re-run 2026-11-05: 1 Blocker open — the `top-center` running toast covers the sticky header nav at 375px (`.playwright-mcp/toast-375-_transactions_import.png`). Fixed in a7ecf6e: top toasts sit 5rem down below `lg`, so the toast starts at 80px under the 61px header at 375 and 768, and stays 24px at 1440 (Playwright, `.playwright-mcp/toast-fix-*.png`). Re-run 2026-11-08: 0 Blockers (header fix confirmed at 375/768/1023 on 5 routes), 2 High still open: (1) the centred top toast covers the "Import from bank" button on `/transactions` at 768 (151×28px) and 1024 (`.playwright-mcp/dr3-toast-pages-transactions-*.png`); (2) the warning toast asks for action but closes after 5 s with no Review link. 2026-11-09: (1) accepted as a known trade-off: every toast position covers something, the toast is closable and stays closed until the finish; (2) fixed: a warning with taken rows now waits and links to Review (`applyNeedsReview`), unit-tested. Re-run 2026-11-09 on the toast delta (Playwright, mocked `currentApply`): 0 Blockers, 0 High. A taken warning stays open past 9 s with Review; gone-only warning and success close at ~5.3 s with no Review; Review closes the toast; AA contrast in both themes (`.playwright-mcp/dr4-*.png`). 2 Medium open: a taken warning covers the title at 375, and warning and error look alike but for the icon. Toast re-validation 2026-11-09 after 600a643 (Playwright, mocked `currentApply`, 1440): a taken warning waits ~34 s, then closes when the next Apply shows on a refetch; only the new running toast is left. Same when the next Apply lands on the refetch right after the finish. No console errors (`.playwright-mcp/v5-*.png`). A newer Apply first seen already finished now closes it too (unit-tested)

## References
- Design doc: `thoughts/designs/2026-11-04-async-duplicate-apply-progress-toast.md` (carries `## Related ADRs`)
- ADRs: `docs/adr/adr032-apply-answers-as-a-background-job-stamped-on-the-review-row.md` (Accepted), implemented by Phases 1–3 (data and repository in Phase 1, job in Phase 2, client in Phase 3)
- Composes with: adr002 (outbox write door), adr004 (3-tier), adr017 (`cdr-import` precedent), adr029 (how reviews are flagged)
- Precedent: `src/server/cdr/cdr.repository.ts:190-205`, `src/server/cdr/cdr.inngest.controller.ts:48-88`, `src/server/cdr/cdr.service.ts:74-94`, `src/app/(dashboard)/transactions/import/_components/import-view.tsx:16-41`
- sonner 2.0.8 behaviour: `node_modules/sonner/dist/index.mjs:189-215,528-565,842,860,1145-1147`
- Related plan: `thoughts/plans/2026-11-04-held-row-better-match-contest.md`. It touches `findMatchCandidates` (`transactions.repository.ts:355-363`), not the Apply path. If both land, rebase the repository line numbers.
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/ui-components.md`, `.claude/rules/unit-testing.md`, `.claude/rules/database-migrations.md`
