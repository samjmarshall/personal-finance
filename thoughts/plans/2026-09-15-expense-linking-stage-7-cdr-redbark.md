---
date: 2026-09-15
design: thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md
adrs: [adr002, adr004, adr005, adr013, adr017, adr021, adr022, adr023]
status: Validated - Phase 5 of 9
---
# Expense Linking Stage 7 — CDR Bank Sync (RedBark) Implementation Plan

## Context

Stage 7 of the roadmap replaces hand entry / statement-CSV toil with a daily bank sync
through [RedBark](https://redbark.com/docs/api-reference/v2/overview), a CDR (open-banking)
aggregator. Banks are linked once in RedBark's dashboard; a single account-level API key then
reads every linked account's settled transactions and balances. Synced rows must become
ordinary `transaction` rows so expense links, categorisation, receipt matching, and the
cash-flow projection keep working unchanged. Re-ingestion must be idempotent and must never
clobber a member's edits. The architecture is settled in
[adr017](../../docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md) (Status: In
Progress) — this plan implements its seven facet decisions, one facet per phase.

Revised 2026-10-20: no member-run scripts. A member sets each account's `inBalance` on
`/settings` (Phase 5), not with `make cdr_in_balance`. History comes from an idempotent import on
`/transactions/import` (Phases 7–8), not from `make cdr_seed` or a 90-day first-run backfill.
Every bank row, whether it comes from the daily sync or an import, is checked against the
household's own rows. An exact match is **adopted** (the household row takes the bank's id). A close match is held as a **possible
duplicate** for a member to resolve. Anything else is added. This replaces facet 5's seeding.

Revised 2026-10-09 after the tRPC 3-tier migration landed. Refs are refreshed, and the plan now
follows [adr021](../../docs/adr/adr021-trpc-router-is-the-controller-tier.md) (controller file
names) and [adr022](../../docs/adr/adr022-cross-domain-data-through-the-owning-service.md)
(cross-domain writes through the owning service). adr022 rules out adr017's single
`db.transaction()` spanning `transaction` + `cdr_sync_state`; ordering replaces it (see
Approach). adr017 was revised in place on 2026-10-09 to match; only the facet 4 sign result is
left for Phase 2.

## Current State

- **Provenance columns landed (Phase 1).** `src/server/transactions/transactions.schema.ts:26-71`
  (columns `:28-54`) has `provenance` / `externalId` / `accountName`; the partial unique index
  sits in the `:55-70` block. pgEnums at `:13-24` are built from TS enums in
  `src/lib/constants.ts` (`Object.values(X) as [X, ...X[]]`). DB column names are camelCase
  (`"asOf"`, `"externalId"`), not snake_case.
- **Transactions is the 3-tier tRPC reference.** Create runs
  `transactions.trpc.controller.ts:20-22` → `TransactionsService.create`
  (`transactions.service.ts:104-111`) → `DrizzleTransactionsRepository.insert`
  (`transactions.repository.ts:217-222`, inserts the DTO as-is). Member-editable fields are
  `transactionFields` (`src/domain/transactions/transaction.dto.ts:31-41`). The read type
  `Transaction` (`src/domain/transactions/transaction.interface.ts:3-20`) is pinned to the table
  by `src/server/db/schema-interface-contract.test.ts:28` — a new column without an interface
  field fails `make check`. Shared instance: `transactions.module.ts`. Upsert precedents (`onConflictDoUpdate`):
  `src/server/settings/settings.repository.ts:41`, `cdr.repository.ts:67`.
- **adr022 owns cross-domain data.** A repository touches only its own domain's tables; other
  domains' reads *and* writes go through the owning service as a narrow `Pick` port.
  `src/server/architecture.test.ts` enforces it (TODO list empty, shrink-only): a
  `cdr.repository.ts` importing `transactions.schema` or `balances.schema` fails. No code runs
  one `db.transaction()` across two domains. Precedent for a repository holding another domain's
  port: `receipts.repository.ts:68-80` (`outbox: OutboxWriteDoor`), wired in
  `receipts.module.ts`.
- **Inngest rails.** Client `src/server/inngest/client.ts:17-22`. `EVENT_REGISTRY`
  `events.ts:13-17` (three `receipt/*` keys); `buildOutboxEvent` `:31-43` always mints a random
  uuid id. Worker root `functions.ts` (logger wiring `:31-40`, `cdrSyncService` build `:46-56`,
  exported array `:63-67`), served
  by `src/app/api/inngest/route.ts` (`maxDuration = 300`, `:11`). Golden: keys
  `registry-golden.test.ts:12-20`, controllers built with `service: {} as never` `:38-40`,
  ids/triggers `:42-54` (`cdr-sync` pinned at `:53`). Cron precedent `outbox.inngest.controller.ts:25-32` (sets no retries or
  concurrency); retry precedent `receipts.inngest.controller.ts:8` (`RETRIES`), `:27-49`.
  `TracingMiddleware.onRunError` reports a run's error on its final attempt only
  (`src/server/inngest/middleware.ts:113-148`).
- **3-tier references** (adr004 / adr021, `.claude/rules/server-architecture.md`). Worker
  service: `src/server/receipts/receipt-extraction.service.ts` (Deps `:220-229` incl.
  `logger: Logger`; retryable rethrow `:343-353`). Adapter interface + class in one file:
  `src/server/email/email.mailbox.ts:19-25`, `:38-86` (`fetch` at `:64-70`,
  `AbortSignal.timeout`); Phase 2's `src/server/cdr/cdr.redbark.ts` follows it and adds
  `RedbarkRetryableError`. HTTP root:
  `src/app/api/receipts/inbound/route.ts:25-58` (env gate → 500, `compose()` memo, `withFlush`);
  verifier inside the controller: `src/server/email/email.http.controller.ts:40-57`; one
  controller serving two routes: `receipts.http.controller.ts:113` (`image`), `:170` (`upload`).
  tRPC root: `src/server/api/services.ts:15-45` + `root.ts:13-23`; smallest template
  `src/server/balances/balances.trpc.controller.ts:4-10`. Procedures are `publicProcedure`
  (`src/server/api/trpc.ts:178`) and `protectedProcedure` (`:184-199`) — no admin role.
- **Balance is manual, insert-only.** `balance_snapshot` at
  `src/server/balances/balances.schema.ts:6-14` (`amount`, `asOf`, no `source`).
  `BalancesService.set` (`balances.service.ts:21-23`) inserts the public `balanceSetDto`
  (`src/domain/balances/balance.dto.ts:6-9`); `latest` (`:16-18`) reads `findLatest`
  (`balances.repository.ts:24-31`, `asOf desc, id desc`). Built inline at `services.ts:15-17`
  and shared with `CashflowService` (pivot read `cashflow.service.ts:56`, anchor `:73-75`);
  pivot maths `src/domain/cashflow/cashflow.ts:271-304`, `:452-458`. `BalanceSnapshot` pinned at
  `schema-interface-contract.test.ts:25`. UI: `src/app/(dashboard)/_components/balance-snapshot-card.tsx`
  (`latest` `:14`, "As of" `:55-57`), mounted in `cash-flow-section.tsx:32`.
- **Dashboard streams by section** ([adr027](../../docs/adr/adr027-async-boundary-for-loading-regions.md)).
  `src/app/(dashboard)/page.tsx` is sync: `PageHeader` `:16-19`, the Phase 6 banner gate
  `:23-25`, then each section in its own `AsyncBoundary` (summary `:29-33`, cash flow `:35-39`,
  spending `:41-45`; spacing sits on a wrapper `div` outside each boundary). A section fetches
  for itself: `StatCards` is an async server component reading `api.*` through
  `overview-data.ts` (`cache()`); `cash-flow-section.tsx:19-20` prefetches for client suspense
  children inside `HydrateClient`. `skeleton={null}` is an invisible gate: nothing while
  loading, and a failure hides the region (still logged) (`async-boundary.tsx:63-69`, `:200`).
- **Env.** `src/env.ts` (not `.js`): `requiredInProd` `:20-23`; optional server-secret precedent
  `RESEND_INBOUND_ADDRESS` (`:130`, runtimeEnv `:186`). Phase 2 added `REDBARK_API_KEY` and
  `REDBARK_API_URL` (`.env.example:39-42`). Resend keys are Vercel
  dashboard secrets, not Terraform (`infrastructure/vercel.tf:55-56`) — adr017's "same
  Terraform→Vercel path as `RESEND_API_KEY`" is wrong.
- **Tests.** `vitest.config.ts` runs `src/**/*.test.ts` in node (`:21-22`) and
  `src/**/*.test.tsx` in jsdom (`:29-30`). Component tests cover props-driven components only
  (`.claude/rules/unit-testing.md`); pure UI logic goes in a `.ts` file
  (`src/app/(dashboard)/receipts/_components/more-details.display.ts` + `.test.ts`). Service
  tests use a fake `logger`, never a `console.error` spy.
- **`cdr` code so far** (Phases 1–4): `src/domain/cdr/` (DTOs, `map-redbark.ts`,
  `cdr.interface.ts`), `src/server/cdr/cdr.redbark.ts`, `cdr.schema.ts`, `cdr.repository.ts`,
  `cdr-sync.service.ts`, `cdr.errors.ts` and `cdr.inngest.controller.ts` (wired in
  `functions.ts:45-60`); `TransactionsService.upsertSynced` (`transactions.service.ts:113-120`). Latest migration is
  `drizzle/0020_wise_penance.sql`.
- **Scripts.** `scripts/blob-prefix-delete.ts` (run by `make db_branch_delete`) is the only
  committed TS script. Phase 5's uncommitted `scripts/cdr-in-balance.ts` and its Makefile
  `cdr_in_balance` target are removed by the revised Phase 5. This plan adds no scripts.
- **Bank-row write path today.** `mapRedbarkTransaction` (`src/domain/cdr/map-redbark.ts:11-42`)
  drops `row.account` (`cdr.dto.ts:20`), so a `transaction` row stores the account's name, not its
  id. `upsertSynced` (`transactions.service.ts:115-120` → `transactions.repository.ts:226-241`)
  dedups on `(provenance, externalId)` only. A bank row is never compared with a member's own row
  (`externalId` null). `CdrSyncService.syncAccount` (`cdr-sync.service.ts:248-275`) fetches from
  `mark − 14d`, or `now − 90d` when the mark is null (`BACKFILL_DAYS` `:17`, `OVERLAP_DAYS` `:19`).
  `listTransactions` (`cdr.redbark.ts:26-29`, `:74-93`) sends no `to`, and `list` throws on
  `x-redbark-truncated` (`:113-115`). The edit guard treats any non-manual row as bank-owned
  (`guardBankValues`, `transactions.service.ts:181-192`). Existing household rows are all
  `provenance = manual`, `externalId` null. Nothing writes `Provenance.Import`.
- **RedBark limits** (`https://api.redbark.com/v2/openapi.json`, read 2026-10-20). `GET
  /transactions` takes `from` and `to` (bare `YYYY-MM-DD`, both inclusive). History reaches back
  about 7 years. One window caps at 5,000 rows (`X-Redbark-Truncated`). `/transactions` is the
  `heavy` tier: 30/min, 4 in flight, `Retry-After` on 429.
- **UI precedents.**
  - Settings: `settings/page.tsx:22-35` prefetches inside the boundary. `settings-view.tsx` has
    `SectionId` at `:21`, the `sections` array at `:34-62` (data panels each in their own
    `AsyncBoundary`), and the page description at `:91`. Panel shell: `settings-section.tsx`.
    Panel skeletons: `settings-panel-skeleton.tsx`. List + mutation section:
    `allowed-senders-section.tsx`.
  - Sub-page shape: `expenses/unplanned/page.tsx:8-36` (`io()`, prefetch, `HydrateClient`).
    Page skeletons live in `src/components/route-skeletons.tsx`.
  - Page actions: `transactions-view.tsx:144-152` (`PageHeader` `actions`).
  - Per-row resolve buttons with a per-row spinner: `MatchBanner`,
    `receipts/_components/receipt-detail.tsx:178-205`.
  - Polling while work is pending: `receipts-view.tsx:192-198` (`refetchInterval`).
  - Date field: plain `<Input type="date">` (`pay-cycle-section.tsx:55-67`). There is no
    date-range picker. Phase 5 adds the shadcn Switch (`src/components/ui/switch.tsx`).
- **Inngest steps.** No function uses `step.run` or `onFailure` yet (`inngest` `4.22.0`). The
  receipts worker parks on its final attempt instead (`receipts.inngest.controller.ts:46-49`).

## Desired End State

A daily Inngest cron (`cdr-sync`, concurrency 1) calls an idempotent `CdrSyncService.run()`.
Per linked account, it:
1. Pulls settled transactions from RedBark: `from = highWaterMark − 14d`, or only the last 14
   days on a first run.
2. Maps them into the app's Spend-positive glossary with a fail-loud sign check.
3. Reconciles them through `TransactionsService.reconcileSynced`. A known bank id refreshes
   **bank-owned columns only**. A household row with no bank id and the same date and amount is
   adopted. A close one (same direction, within 5% and 7 days) becomes a pending possible
   duplicate. Anything else is added.
4. Only then advances the account's cursor in `cdr_sync_state` (never backwards).

History comes from `/transactions/import`. A member picks a date range, and an Inngest job
(`cdr-import`) runs the same reconcile over that range in 90-day chunks. It never moves the
cursor. Re-running a range adds nothing new and asks nothing twice. The same page lists each
pending possible duplicate with three choices: **Keep mine**, which drops the bank row and is
remembered; **Use bank's**, which moves the bank's values onto the member's row and keeps its
links; and **Both are real**, which adds the bank row. Nothing is deleted without one of those
choices.

When every account counted toward cash (`inBalance`: transaction, savings and credit-card
accounts by default, never loans; a member changes it on `/settings` → Bank accounts) is
syncable and reports `fresh`, the sync anchors one household `balance_snapshot` row through
`BalancesService.recordSynced`; that row replaces a typed balance until the member types a newer
one. A dead consent (`revoked|expired|invalidated`) stops that connection and shows on the
dashboard; it is not retried. An unset `REDBARK_API_KEY` makes the whole cron a no-op and fails
an import. A signed RedBark webhook can trigger the same idempotent `run()` early. Every member
edit (description, category, group, expense link, notes, receipt) survives every re-sync and
every import.

## Out of Scope

- **PayPal sync** — the other half of roadmap stage 7; its own plan (the `paypal` provenance
  value is provisioned here but no PayPal code is written).
- **Transfer-filtering** — internal transfers double-count as paired Spend + Inflow (adr017
  Negative Consequences); deferred to its own design.
- **`cdr` vs `paypal` consolidation.** The same purchase arriving from both is not merged
  (PayPal isn't built). Bank rows vs the household's own rows are handled by Phases 7–8.
- **Deleted synced rows.** A member-deleted bank row comes back when a later run's 14-day
  overlap or an import covers its date. No tombstones. Only a **Keep mine** choice is
  remembered.
- **Tuning the match.** The window is fixed at 7 days and 5% of the member's amount.
- **Bulk review or undo.** Each possible duplicate is resolved one at a time, and a choice
  can't be undone in the UI.
- **Choosing accounts per import.** An import covers every account the daily sync would sync.
- **In-app per-user consent / redirect flow** — banks are linked manually in RedBark's
  dashboard (adr017 credential posture).
- **Multi-currency** — non-AUD rows fail loud; single-currency asserted.
- **Per-account balance history / a `cdr_connection` table** — `connectionStatus` stays
  denormalised on `cdr_sync_state`; promote later only if the app launches publicly.
- **Adopting RedBark's hierarchical categories** — synced rows land uncategorised.
- **Household scoping** — new tables follow the current unscoped pattern.
- **A settings-page status surface** — connection health stays in the dashboard banner. The
  Bank accounts section shows each account's name, bank, masked number, latest balance and
  `inBalance` choice only.
- **Nicknames beyond Settings** — a nickname renames the account on Settings → Bank accounts
  only. A synced transaction keeps the bank's account name (`mapRedbarkTransaction`).
- **Unlinked money in the balance line** — a synced anchor replaces a typed balance (adr017
  facet 6); no "unlinked funds" setting is added to the sum.

## Approach

Build the seven adr017 facets bottom-up so each phase ships alone and the risky,
external-facing work is verified before anything depends on it: schema foundation → adapter +
the sign-mapping sandbox spike (resolves adr017 Open Question #1) → sync state + the
transactions upsert → cron service + controller → balance anchor + Bank accounts settings →
connection banner → matching (reconcile + possible duplicates) → import job + page → webhook
trigger. Nine phases. Matching (Phase 7) lands before the import (Phase 8) so history never
arrives through the plain upsert.

The new `cdr` domain is a class-based 3-tier (adr004) with adr021 file names
(`cdr.inngest.controller.ts`, `cdr.trpc.controller.ts`, `cdr.http.controller.ts`). Under adr022,
`cdr.repository.ts` touches only `cdr_sync_state` and `cdr_import`. Matching lives in the
transactions domain (`TransactionsService.reconcileSynced`, which replaces `upsertSynced` as the
sync's write in Phase 7) and owns the `possible_duplicate` table. The anchor insert lives in the
balances domain (`BalancesService.recordSynced`). Each is reached through a `Pick` port.

**No cross-domain `db.transaction()`.** Per account, the service upserts first and then advances
the cursor. If the upsert throws, the cursor stays put. If the process dies between the two
steps, the next run re-fetches the same window and the idempotent upsert absorbs it. adr017's
"never advance the cursor past un-ingested rows" still holds, by ordering alone. The cursor is
monotonic (`greatest`), so a short fetch never drags it back into the overlap or below an earlier
mark. Sync writes take no outbox event (the cron is the trigger; receipt matching is read-time).
Starting an import does: the `cdr_import` row and its `cdr/import.requested` event commit
together through `outbox.commit` in the cdr repository, like `receipts.repository.ts:88-98`.

**Two cdr services** (split rule: disjoint deps):
- `CdrSyncService` is the worker. It uses RedBark, transactions and balances. It runs both the
  daily sync and an import's chunks.
- `CdrService` serves tRPC (account list, `inBalance`, import start and status) and webhook
  intake. It uses the repository, plus the outbox for webhook events (Phase 9). An import's
  event commits inside the repository instead, because it needs the new row's id.

So `services.ts` never needs the optional key. Non-trivial pure logic is built test-first per
the `tdd` skill: sign mapping, the scoped upsert, the freshness gate, the monotonic cursor, the
banner copy, the match pairing, and the import's date chunks.

---

## Phase 1: Provenance schema foundation

Implements adr017 facet 1 (provenance model). Backend only, no UI.

### Changes
- `src/lib/constants.ts` — add `export enum Provenance { Manual = "manual", Import = "import",
  Cdr = "cdr", Paypal = "paypal" }`, shaped like `ReceiptChannel` (`:34-37`).
- `src/server/transactions/transactions.schema.ts` — add pgEnum `transactionProvenance`
  (`"transaction_provenance"`, now `:21-24`); columns `provenance`
  (`.notNull().default(Provenance.Manual)`), `externalId` (text, null), `accountName` (text,
  null) in `:28-54`; in the `:55-70` block a **partial**
  ``uniqueIndex("transaction_provenance_external_idx").on(t.provenance, t.externalId).where(sql`${t.externalId} is not null`)``
  (partial-index precedent `src/server/outbox/outbox.schema.ts:30`). Unlimited NULL-`externalId`
  manual rows coexist with one row per `(cdr, txn.id)`.
- `src/domain/transactions/transaction.interface.ts` — add `accountName: string | null`,
  `externalId: string | null`, `provenance: Provenance` to `Transaction` (`:3-17`, alphabetical).
  Forced by `schema-interface-contract.test.ts:28`.
- `src/domain/transactions/transaction.dto.ts` — **no change**: `transactionFields` (`:31-41`)
  stays provenance-free, so a member can't set or change provenance; the DB default stamps
  `manual` on `create` (`transactions.repository.ts:200-205` unchanged).
- Transactions test fixtures — add the three fields to the `Transaction` fixtures in
  `transactions.repository.test.ts:27-44`, `transactions.service.test.ts:54-71`,
  `transactions.trpc.controller.test.ts:20-37`; refresh the column-list inline SQL snapshots in
  `transactions.repository.test.ts` (`:91`, `:373`, `:420`, `:454`, `:564`).
- `src/server/transactions/transactions.schema.test.ts` — assert `provenance` defaults to
  `Provenance.Manual`, `externalId` / `accountName` are nullable, and the unique index exists
  (name, columns, a `where`) via `getTableConfig(transactions).indexes`.
- `drizzle/0019_*.sql` — `make db_generate`, then `make db_migrate` on the `local/<branch>` Neon
  branch.

### Success
- [x] `make check` passes (incl. `db:check` and the schema↔interface contract)
- [x] `make test` passes
- [x] `/security-review` (touches `src/lib/**`) — no findings
- [x] Migration applies cleanly on the branch DB; a transaction created through the app reads
      back `provenance = 'manual'`, `externalId = null` (checked with the app's insert column
      set in a rolled-back transaction; the repository snapshot pins `default` for all three)
- [x] Two manual rows with NULL `externalId` insert fine; two rows with the same
      `(cdr, 'txn_x')` violate the partial unique index

---

## Phase 2: RedBark adapter + sign-mapping sandbox spike

Implements adr017 facets 3 (settled-only) and 4 (sign + amount mapping). Resolves adr017 Open
Question #1. **Prerequisite:** a RedBark `livemode:false` sandbox API key.

### Changes
- `src/lib/constants.ts` — add `export enum CdrConnectionStatus` (`pending | active | expiring |
  expired | invalidated | revoked`); it feeds the Zod DTO now and the pgEnum in Phase 3.
- `src/env.ts` — add `REDBARK_API_KEY: z.string().optional()` (server-only, **not**
  `requiredInProd`: an unset key no-ops the cron, adr017 credential posture) and
  `REDBARK_API_URL: z.url().default("https://api.redbark.com")`, plus both `runtimeEnv` lines.
  Mirror `RESEND_INBOUND_ADDRESS` (`:130`, `:186`). `.env.example:39-42` already lists both; add
  a one-line comment that the key is optional.
- `src/domain/cdr/cdr.dto.ts` + `index.ts` — Zod DTOs for RedBark `Transaction` (`Money` =
  integer minor units + `currency`; optional `direction` / `status`), `Account`, `Connection`
  (`status: z.enum(CdrConnectionStatus)`), and `Balance` (`current`, `freshness`, `observed_at`).
  Fields the sync never reads (`available`, an account's `currency`) are left out: each one
  parsed is one more way for the parse to fail. **No `cdr.interface.ts` yet**: `schema-interface-contract.test.ts:66-74` wants a
  table pair for every domain interface file, and the table lands in Phase 3.
- `src/domain/transactions/transaction.interface.ts` — add `SyncedTransaction` (`provenance`,
  `externalId`, `accountName`, `date`, `description`, `amount`). This is the upsert input the
  transactions domain owns. It is not a table type, so the contract test is unaffected.
- `src/domain/cdr/map-redbark.ts` — pure `mapRedbarkTransaction(row, accountName):
  SyncedTransaction`:
  - Prefer `direction`: `debit` → Spend **positive**, `credit` → Inflow **negative**.
  - Cross-check the numeric sign and **throw on disagreement**.
  - Negate the number only when `direction` is absent.
  - Convert `Money.amount` ÷ 100.
  - Assert `currency === "aud"`, else throw.

  Sources: adr017 facet 4; `CONTEXT.md:171-173` (positive = Spend).
- `src/server/cdr/cdr.redbark.ts` — `interface RedbarkClient` + `class HttpRedbarkClient` in one
  file (per `email.mailbox.ts:19-86`). Deps `{ apiKey, baseUrl }`, built only in a composition
  root.
  - Methods: `listConnections()`, `listAccounts()`, `listTransactions({ accountId, from })` and
    `getAccountBalance(accountId)`.
  - `listTransactions` follows `next_page_url` to null and sends `include_pending=false` (adr017
    facet 3).
  - Headers: the bearer key, and `Redbark-Version` from a **code constant**
    `REDBARK_VERSION = "2026-10-01.wattle"`.
  - Every call uses `AbortSignal.timeout` (as `:64-70`) and parses the response with the Zod
    DTOs.
  - On `429`, `5xx` or a network failure, throw a local `RedbarkRetryableError` that carries
    `retryAfterMs: number | null`, parsed from `Retry-After`. The header may be delta-seconds or
    an HTTP-date. A missing, unparseable or past value gives `null`. Any other non-2xx throws a
    plain `Error`.
- **Sandbox spike:** call the sandbox with the key, capture one real settled debit row and one
  real settled credit row, and pin `mapRedbarkTransaction` against them as fixtures.
- `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` — record the confirmed sign
  convention in facet 4 and Open Questions, take facet 4 off "pending spike", and update Status.
  The construction, cursor and key text was already revised on 2026-10-09.
- Tests:
  - `src/domain/cdr/map-redbark.test.ts` — table-driven: debit → +, credit → −, direction /
    numeric disagreement → throw, missing direction → negation fallback, non-AUD → throw, minor
    units ÷ 100, and the pinned sandbox fixtures.
  - `src/domain/cdr/cdr.dto.test.ts` — parses a captured sandbox page and rejects an unknown
    connection status.
  - `src/server/cdr/cdr.redbark.test.ts` — stub `fetch` with `vi.stubGlobal` (as
    `email.mailbox.test.ts:34-38`). Assert the auth and `Redbark-Version` headers,
    `include_pending=false`, and that `next_page_url` is followed to null. For `Retry-After`:
    - `429` with `Retry-After: 30` throws `RedbarkRetryableError` with `retryAfterMs: 30000`.
    - An HTTP-date header gives the ms until that date.
    - A missing or garbage header gives `null`.
    - A `503` and a network failure are retryable; a `400` is a plain `Error`.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `/security-review` (touches `src/env.ts`; new outbound HTTP with a bearer key)
- [ ] The sandbox spike is done and `mapRedbarkTransaction` is pinned against real sandbox rows;
      adr017 facet 4 no longer says "pending spike"
      — RedBark has no sandbox, so the spike ran live (read-only, 2026-10-16) and adr017 facet 4
      records it. Fixtures are made-up values in the live field shape: real bank rows were kept
      out of this public repo. Open: does that satisfy "pinned against real rows"?
- [x] A `credit` row maps to a negative amount and a `debit` row to a positive amount; a row
      whose `direction` and numeric sign disagree throws; a non-AUD row throws

---

## Phase 3: `cdr_sync_state` + the transactions upsert

Implements adr017 facets 2 (dedup upsert) and 5 (store-of-record via `cdr_sync_state`).

### Changes
- `src/server/cdr/cdr.schema.ts` — pgEnum `cdr_connection_status` from `CdrConnectionStatus`.
  Table `cdr_sync_state` has one row per account (adr017 facet 5):

  | Column | Type |
  | --- | --- |
  | `id` | identity PK |
  | `accountId` | text, not null, unique |
  | `connectionId` | text, null (was for a seeded row; the seed is gone, so discovery always sets it) |
  | `accountName` | text, null |
  | `highWaterMark` | timestamptz, null |
  | `connectionStatus` | enum, not null, default `pending` |
  | `lastSyncedAt` | timestamptz, null |
  | `lastError` | text, null |
  | `createdAt` | timestamptz, not null, **DB** default `.defaultNow()` (as `outbox.schema.ts:19`, not `$defaultFn`: a raw-SQL insert, like the since-removed seed, still gets it) |
  | `updatedAt` | timestamptz, null |
- `src/server/db/index.ts` — add `cdrSchema` to the imports (`:5-14`) and the merged `schema`
  (`:17-28`).
- `src/domain/cdr/cdr.interface.ts` — `CdrSyncState`. Add the pair to
  `schema-interface-contract.test.ts`: `Contracts` (`:24-32`), `COVERED` (`:42-50`) and
  `aligned` (`:61`).
- `src/server/cdr/cdr.repository.ts` — `interface CdrRepository` + `class DrizzleCdrRepository`
  (deps `{ db }`). It touches **only** `cdr_sync_state`: Drizzle only, throws, no logging.
  Methods:
  - `listSyncState()`
  - `findSyncState(accountId)`
  - `upsertAccount({ accountId, connectionId, accountName, connectionStatus })` —
    `ON CONFLICT (accountId)`; never touches `highWaterMark`.
  - `advanceHighWaterMark(accountId, mark, syncedAt)` — **monotonic**:
    `greatest("highWaterMark", $mark)`. It also sets `lastSyncedAt` and clears `lastError`.
  - `setConnectionStatus(connectionId, status)` — updates every account on that connection.
  - `recordError(accountId, message)`
- `src/server/transactions/transactions.repository.ts` + `transactions.service.ts` — add
  `upsertSynced(rows: SyncedTransaction[])` to the repository interface (`:52-73`), the class, and
  the service.
  - The service drops repeats of the same `(provenance, externalId)`, keeping the last, then
    delegates. Postgres refuses one `ON CONFLICT DO UPDATE` that hits a row twice (SQLSTATE
    21000), and a page that shifts mid-fetch can return a row twice.
  - The repository runs one multi-row `insert(...).onConflictDoUpdate`.
  - `target` is `[provenance, externalId]`.
  - ``targetWhere: sql`${transactions.externalId} is not null` `` is required: Postgres only
    infers a partial unique index when the predicate is in the conflict target (drizzle 0.45).
  - `set` takes the `excluded` values for **only** `amount`, `date` and `accountName`. Drizzle
    adds `updatedAt` itself (its `$onUpdate` at `transactions.schema.ts:53` runs on
    `onConflictDoUpdate` too); leave it.
  - It never sets `description` (INSERT-only) or the member-owned `expenseId`, `categoryId`,
    `group`, `priority`, `frequency` and `notes`.
  - Empty `rows` runs no statement.
- `transactions.service.ts` `update` (`:107-118`) — **a synced row's `amount` and `date` belong
  to the bank.** The upsert rewrites both on every run inside the 14-day overlap, so a member's
  edit would vanish with no warning. `transactionUpdateDto` still accepts both
  (`transaction.dto.ts:31-41`; the form posts every field).
  - Add repository `findSyncedValues(id)` → `{ provenance, amount, date } | undefined`.
  - When the row isn't `manual` and `amount` or `date` differs from the stored value, `update`
    throws `InvalidInputError` ("Amount and date come from the bank") before writing.
  - Unchanged values pass, so editing a synced row's notes or group still works.
  - *Added in build:* `transactions/_components/submitted-date.ts` (+ test). The form parsed
    the day as local midnight, but a synced row is stored at UTC midnight, so an untouched day
    posted a new instant and the exact guard refused it. An untouched day now sends back the
    saved `Date`.
- Tests:
  - `src/server/cdr/cdr.repository.test.ts` — `recordingDb()` (`src/server/db/recording-db.fake.ts`;
    usage `src/server/settings/settings.repository.test.ts:9-16`) with inline SQL snapshots:
    - The `upsertAccount` conflict target, and a `set` without `highWaterMark`.
    - `advanceHighWaterMark` renders `greatest(...)`.
    - `setConnectionStatus` filters on `connectionId`.
  - `src/server/cdr/cdr.schema.test.ts` — `connectionStatus` defaults to `pending`; `accountId`
    is unique.
  - `src/server/transactions/transactions.repository.test.ts` — inline snapshot of
    `upsertSynced`:
    - The conflict target `("provenance", "externalId") where "externalId" is not null`.
    - `do update set` lists only `amount`, `date`, `accountName` and the automatic `updatedAt`.
    - Empty input runs no statement.
  - `transactions.service.test.ts` — `upsertSynced` delegates; two rows with the same
    `externalId` reach the repository as one (the later one). `update` on a `cdr` row with a
    changed `amount` or `date` throws `InvalidInputError` and writes nothing; the same values
    pass; a `manual` row may change both.
- `drizzle/0020_*.sql` — `make db_generate` + `make db_migrate`.

### Success
- [x] `make check` passes (incl. `db:check`, the contract, and `architecture.test.ts` with its
      TODO list still empty)
- [x] `make test` passes
- [x] The upsert's `DO UPDATE` touches only bank-owned columns (asserted in the repository
      test); on the branch DB, re-upserting an existing `(cdr, txn.id)` leaves `expenseId`,
      `categoryId`, `group` and `description` untouched
- [x] Editing a synced row's amount is refused; editing its notes saves
- [x] Advancing the cursor to an older mark leaves it unchanged

---

## Phase 4: `cdr` sync service + cron controller (poll)

Implements adr017 facet 7 (poll-first) and the construction rules. **Depends on Phase 2's
pinned mapping.**

### Changes
- `src/domain/cdr/cdr.dto.ts` — `redbarkAccountDto` gains `status: z.enum(["available",
  "syncing", "unavailable"])` (`AccountItem.status`), strict like the connection status.
- `src/server/cdr/cdr-sync.service.ts` — `class CdrSyncService` (second-service naming per
  `receipt-extraction.service.ts`). `interface CdrSyncServiceDeps { repository: CdrRepository;
  redbark: RedbarkClient | null; transactions: Pick<TransactionsService, "upsertSynced">;
  logger: Logger }`. `run()` is idempotent:
  - **No key.** `redbark === null` → `logger.info` and return.
  - **Discover.** List connections and accounts, then `upsertAccount` each one, mirroring
    connection status. Then `setConnectionStatus` for every listed connection, so a saved row
    whose dead bank no longer lists its accounts still gets that status. Any error here is
    rethrown as a `CdrSyncError` with the original as `cause`; a `RedbarkRetryableError` passes
    on its `retryAfterMs` and makes it `retryable`. The controller reads only `CdrSyncError`, and
    a 429 is most likely on the run's first call.
  - **Saved account RedBark didn't return.** A `cdr_sync_state` row whose `accountId` is not in
    the discovered list (a bank removed from RedBark, or an old link's account) would stay `pending`
    and never sync, with nothing saying why. It counts as a failed account instead (see
    Failures): `recordError(accountId, "not in RedBark")` + `logger.error` naming the id. It is
    not retryable, so the run fails loud. Fix: delete that row in the Neon SQL editor (see
    the re-link runbook in Validate). A row whose saved connection is listed but dead
    (`revoked | expired | invalidated`) isn't this case: Consent skips it, and the banner asks
    for a reconnect (deleting it would lose its mark).
  - **Consent** (adr017 credential posture):
    - `revoked | expired | invalidated` → skip that connection's accounts and `logger.warn`.
      Never retried.
    - `expiring` → `logger.warn`, then sync as normal.
    - `pending` → skip.
    - *Added in build:* an account whose connection RedBark doesn't list is saved as
      `pending`, so it waits until RedBark lists that connection.
  - **Account status** (RedBark's per-account `status`, apart from consent):
    - `syncing` → skip this run with `logger.info`. Its first history is still arriving, so
      syncing now could move the mark past rows that land later.
    - `unavailable` (closed, or taken off the consent; its reads answer `404
      account_unavailable`) → skip, `recordError(accountId, "unavailable in RedBark")` +
      `logger.warn`. Not a failed account, so `run()` doesn't throw: RedBark keeps listing it,
      so a throw would fail every run for good. Its `lastError` shows the Phase 6 notice, and
      clears once RedBark lists it `available` and it syncs.
  - **Per syncable account:**
    1. `from = highWaterMark − 14d`, or 90 days ago when the mark is null (facet 5). `from`
       filters on `date`, which isn't the posting date (RedBark has a separate `post_date`), so
       a card row can settle 5+ days after its `date` over a long weekend.
    2. Fetch every settled page.
    3. Map each row with `mapRedbarkTransaction`.
    4. `transactions.upsertSynced(rows)`.
    5. **Then** `repository.advanceHighWaterMark(accountId, min(newest row date, now) ?? current
       mark, now)`. The mark is monotonic, so one bad future date would stop the account for
       good; the cap keeps it at most today.
       *Added in build:* a first run that finds no rows has no mark to keep, so the mark
       starts at `from`; the next run only widens its window.
  - **Failures.** Each account runs in its own try/catch. A failure (`RedbarkRetryableError`, a
    driver error, a mapping throw, or a saved account RedBark didn't return) does
    `recordError` + `logger.error`, and the loop moves on.
    After the loop, if any account failed, `run()` throws one `CdrSyncError`
    (`src/server/cdr/cdr.errors.ts`). It names the failed accounts, keeps the first error as
    `cause`, and carries `retryAfterMs`: the longest wait among the failed accounts'
    `RedbarkRetryableError`s, or `null` when none gave one. It also carries `retryable`: true
    when any failed account threw a `RedbarkRetryableError`. A mapping throw or a RedBark 4xx
    fails the same way every attempt, so retrying it only re-fetches every account
    (`.claude/rules/server-architecture.md` retry contract: park on a deterministic error;
    `recordError` is the park). A driver error isn't retried either: the cursor didn't move, so
    the next daily run picks it up. When `retryable`, Inngest retries the whole idempotent run,
    and `TracingMiddleware.onRunError` reports the final failure. So there is no
    `isFinalAttempt` and no `errorReporter` dep, and one bad account never blocks the others.
    The service never imports `inngest`: the wait is plain data, and the controller turns it
    into Inngest's signal.
  - **No outbox event.**
- `src/server/cdr/cdr.inngest.controller.ts` — `class CdrInngestController` (deps
  `{ inngest, service: CdrSyncService }`, `RETRIES = 3`). It declares `cdr-sync`: `id:
  "cdr-sync"`, `retries: RETRIES`, `concurrency: { limit: 1 }`, `triggers: [{ cron: "0 18 * * *"
  }]` (UTC, about 4–5 am Sydney; frozen once shipped). The handler closes over `this.service`
  lazily (as `outbox.inngest.controller.ts:25-32`) and calls `this.service.run()`.
  - **Don't retry a deterministic failure.** The handler catches only a `CdrSyncError`. Not
    `retryable` → inngest's `NonRetriableError(message, { cause: error })`
    (`node_modules/inngest/components/NonRetriableError.d.ts`), so the run fails at once.
  - **Honour `Retry-After`** (adr017 credential posture). A `retryable` `CdrSyncError` with a
    non-null `retryAfterMs` up to `MAX_RETRY_AFTER_MS` is rethrown as inngest's
    `RetryAfterError(message, retryAfterMs, { cause: error })`
    (inngest 4.22, `node_modules/inngest/components/RetryAfterError.d.ts`).
  - `MAX_RETRY_AFTER_MS = 60 * 60 * 1000` sits beside `RETRIES`. A longer wait →
    `NonRetriableError`, left to the next daily cron: retrying before RedBark's wait is up only
    draws another 429, and a bad header still can't park the run for days.
  - Every other error is rethrown unchanged, so Inngest's own backoff applies.
  - This is the only try/catch in an Inngest controller. It maps a transport-free error to the
    transport's retry signal, the same job the tRPC error middleware does for error codes.
  - `get functions()` returns `[this.sync]`.
- `src/server/inngest/functions.ts`:
  - Build `new CdrSyncService({ repository: new DrizzleCdrRepository({ db }), redbark:
    env.REDBARK_API_KEY ? new HttpRedbarkClient({ apiKey: env.REDBARK_API_KEY, baseUrl:
    env.REDBARK_API_URL }) : null, transactions: transactionsService, logger:
    createRootLogger().with({ domain: "cdr", component: "sync" }) })`.
  - Wrap it in `CdrInngestController` and spread `...cdrController.functions` into `:41-44`.
  - `transactionsService` comes from `transactions.module.ts`.
- `src/server/inngest/registry-golden.test.ts` — **deliberate** golden update: build
  `CdrInngestController` with `service: {} as never` (`:37-38`) and append
  `{ id: "cdr-sync", triggers: [{ cron: "0 18 * * *" }] }` to `:40-51`. `EVENT_REGISTRY` keys are
  **unchanged** this phase.
- `.claude/rules/server-architecture.md` — add `cdr-sync` to the FROZEN function-id list.
- Tests:
  - `src/server/cdr/cdr-sync.service.test.ts` — fake `repository` / `redbark` / `transactions` as
    object literals recording calls, and a fake `logger` recording `{ level, msg, attrs }`
    (pattern `receipt-extraction.service.test.ts:115-190`). Assert:
    - A null mark does the 90-day backfill (Phase 7 cuts it to 14 days); otherwise
      `from = hwm − 14d`.
    - Every page is consumed and the mapping is applied.
    - `upsertSynced` is called **before** `advanceHighWaterMark`, and advance is skipped when
      the upsert throws.
    - A row dated after `now` advances the mark only to `now`.
    - A terminal consent skips its accounts without retry; `expiring` warns and syncs.
    - One failing account still lets the others sync, records `lastError`, then `run()` throws
      a `CdrSyncError`.
    - Two accounts failing with `retryAfterMs` 30 000 and 90 000 give `retryAfterMs: 90000`. A
      mapping throw alone gives `null` and `retryable: false`; one `RedbarkRetryableError`
      among the failures gives `retryable: true`.
    - `listConnections` throwing `RedbarkRetryableError` with `retryAfterMs: 30000` → a
      `CdrSyncError` with `retryAfterMs: 30000`; no account is fetched.
    - A saved row RedBark didn't return gets `recordError` and an error log naming its id; the
      other accounts still sync; `run()` throws a `CdrSyncError` with `retryable: false`.
    - A saved row whose connection is listed as `revoked` but whose account isn't listed gets
      `revoked`, no error, and no fetch.
    - A `syncing` account gets no fetch and no error. An `unavailable` one gets no fetch and a
      `recordError`, and `run()` resolves when nothing else failed.
    - `redbark: null` makes no calls.
  - `src/server/cdr/cdr.inngest.controller.test.ts` — spy `createFunction` (pattern
    `outbox.inngest.controller.test.ts:5-32`). Assert the frozen id, retries, concurrency and
    cron, and that the handler calls `service.run()`. With a fake service that throws:
    - A `CdrSyncError` with `retryAfterMs: 30000` → `RetryAfterError` with `retryAfter` `"30"`
      and the original as `cause`. Inngest stores a number as whole seconds, rounded up
      (`node_modules/inngest/components/RetryAfterError.js`), despite its doc comment.
    - `retryAfterMs` of exactly 1 h → `RetryAfterError` with `"3600"`; over 1 h →
      `NonRetriableError` with the original as `cause`.
    - A `CdrSyncError` with `retryable: false` → `NonRetriableError` with the original as
      `cause`.
    - A `retryable` `CdrSyncError` with `null`, or any other error, is rethrown as the same
      object.

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `registry-golden.test.ts` pins `cdr-sync` and its cron trigger (deliberate update)
- [x] With the live key on the branch DB (RedBark has no sandbox; the run only reads RedBark),
      invoking `cdr-sync` from the Inngest dev server ingests settled rows, and a second invoke
      adds no new rows; with the key unset the run is a logged no-op
      — 2026-10-20: run 1 ingested 1015 rows over 11 accounts, all `active`, no `lastError`;
      run 2 COMPLETED with the count unchanged. Key unset: "cdr sync skipped" log, COMPLETED.
- [x] When RedBark answers `429` with `Retry-After`, the Inngest dev server shows the next
      attempt scheduled after that wait (a wait over 1 h fails the run until the next cron),
      not on Inngest's default backoff
      — 2026-10-20, stub `REDBARK_API_URL` answering 429: `Retry-After: 90` → next attempt
      89 s later; `Retry-After: 7200` → one attempt, run FAILED at once.
- [x] *Added in validation:* a body cut off mid-read (reset, or the 15 s timeout) retries;
      bad JSON fails at once
      — 2026-10-20, stub answering 200 then breaking the body: reset → next attempt 26 s later;
      stall → timeout, next attempt; `<html>` body → one attempt, run FAILED.

---

## Phase 5: Balance auto-anchor

Implements adr017 facet 6. Touches the dashboard balance card (UI honesty label) and adds a
Bank accounts section to `/settings`.

**Reopened 2026-10-20.** The anchor is built and verified (notes below). The member-run
`make cdr_in_balance` script it shipped with is replaced by the Bank accounts section, so a
member sets `inBalance` in the app. `CdrService` and `cdrRouter` move here from Phase 6.

**Reopened 2026-10-21 (prototype D).** The radio pair is replaced by prototype variant D
(drafts A, B and D on local branch `prototype/settings-bank-accounts`; C was dropped). Three
accounts named "Everyday Offset" couldn't be told apart, so each row now shows the bank,
RedBark's masked account number and the latest balance, and a member can rename an account. A
switch replaces **Counts** / **Left out**. Balance reads move to RedBark's bulk `GET /balances`:
one call per run reads every account, saves each balance for the list, and feeds the anchor.

**Which accounts count** (decided 2026-10-19). Each account has its own `inBalance` flag. Credit
cards count: they are paid in full each month, so their negative balance shows money already
spent. Car and home loans don't. RedBark's account `type` is free text with no documented list
(`AccountItem.type` in `https://api.redbark.com/v2/openapi.json`); the live spike saw
`transaction`, `loan` and `credit-card`.

**Card balance sign is assumed, not seen.** CDR's `currentBalance` is negative when money is
owed, but the Phase 2 spike only checked transaction rows. Before building, read one live card
balance with money owing (read-only, as the Phase 2 spike) and confirm `current` is negative;
note it in adr017 facet 6. If it's positive, stop and re-plan: the sum would count card debt as
cash.

**Synced vs typed balance** (decided 2026-10-19). The daily synced row replaces a typed one;
money in unlinked banks is not counted. Precedence stays pure latest-`asOf`.

### Changes
- `src/lib/constants.ts` — add `export enum BalanceSource { Manual = "manual", Cdr = "cdr" }`.
- `src/server/balances/balances.schema.ts` — pgEnum `balance_source` and a `source` column
  (`.notNull().default(BalanceSource.Manual)`) in `:6-14`. **Label only**: precedence stays pure
  latest-`asOf`, tiebreak `id desc` (`balances.repository.ts:24-31` unchanged; adr017 facet 6).
- `src/server/cdr/cdr.schema.ts` — add `inBalance` (boolean, **null**) to `cdr_sync_state`.
  Null means "not decided yet": a row saved before this column has no type until its next discovery fills it.
  `src/domain/cdr/cdr.interface.ts` gains `inBalance: boolean | null`.
- `drizzle/0021_*.sql` (both changes) via `make db_generate` + `make db_migrate`.
- `src/domain/cdr/cdr.dto.ts` — `redbarkAccountDto` gains `type: z.string()`. A string, not an
  enum, so a new RedBark type can't fail discovery.
- `src/domain/cdr/map-redbark.ts` — pure `inBalanceByDefault(type): boolean | null`:
  `transaction`, `savings` and `credit-card` → true; `loan` → false; any other type → null
  (undecided: holds the anchor until set).
- `src/server/cdr/cdr.repository.ts` — `upsertAccount` takes `inBalance`. Its `set` writes
  ``sql`coalesce(${cdrSyncState.inBalance}, excluded."inBalance")` ``, so discovery fills the
  flag once and never overwrites a member's choice.
- `src/server/cdr/cdr-sync.service.ts` (discovery) — passes `inBalanceByDefault(account.type)`
  to `upsertAccount`. Each run, an account whose flag is still null logs `warn` with its type
  until the member sets it, so a savings account under an unexpected type name shows up (and
  the anchor waits for it).
- **Remove the script.** Delete `scripts/cdr-in-balance.ts` and the `Makefile` `cdr_in_balance`
  target (`Makefile:75-76`, and its `.PHONY` entry at `:5`). Reword the JSDoc at
  `cdr-sync.service.ts:167` ("a member's `make cdr_in_balance` choice") to name Settings → Bank
  accounts. adr017 facet 6's "(`make cdr_in_balance`)" becomes "(Settings → Bank accounts)".
- `src/server/cdr/cdr.repository.ts` — `setInBalance(accountId, inBalance)` updates one row's
  `inBalance` and `updatedAt` and returns the row, or `undefined` when no row has that id.
- `src/domain/cdr/cdr.dto.ts` — `cdrSetInBalanceDto = z.object({ accountId: z.string().min(1),
  inBalance: z.boolean() })`. Export it from `src/domain/cdr/index.ts`.
- `src/server/cdr/cdr.service.ts` — `class CdrService` (deps `{ repository: CdrRepository }`).
  It is separate from `CdrSyncService`, so the tRPC root never builds RedBark, transactions or
  balances.
  - `listSyncState()` delegates.
  - `setInBalance({ accountId, inBalance })` → `NotFoundError` when the repository returns
    `undefined` (`src/server/errors/domain-errors.ts`). Discovery's `coalesce` (above) keeps
    the choice through every later sync.
- `src/server/cdr/cdr.trpc.controller.ts` — `cdrRouter` (template
  `balances.trpc.controller.ts:4-10`):
  - `syncState: protectedProcedure.query(({ ctx }) => ctx.services.cdr.listSyncState())`
  - `setInBalance: protectedProcedure.input(cdrSetInBalanceDto).mutation(...)`
  - Mount it as `cdr` in `src/server/api/root.ts:13-23`. Build `cdr: new CdrService({
    repository: new DrizzleCdrRepository({ db }) })` in `services.ts:24-40`.
- **Account details for the list** (prototype D):
  - `src/server/cdr/cdr.schema.ts` — five nullable columns on `cdr_sync_state`, no defaults:
    - Bank-owned, refreshed by discovery: `institutionName` (RedBark `institution.name`) and
      `accountNumber` (RedBark's masked `account_number`, last four digits, e.g. `xxxx8273`).
    - Bank-owned, refreshed by the balance read: `balance` (double precision, dollars, like
      `balance_snapshot.amount`) and `balanceAsOf` (timestamptz, RedBark `observed_at`).
    - Member-owned: `nickname`. Discovery's `set` never names it, so a sync can't overwrite it.
    - `src/domain/cdr/cdr.interface.ts` gains the five fields (forced by
      `schema-interface-contract.test.ts`).
  - `drizzle/0022_*.sql` via `make db_generate` + `make db_migrate`.
  - `src/domain/cdr/cdr.dto.ts` — `redbarkAccountDto` gains `institution: z.object({ name:
    z.string() })` and `account_number: z.string().nullable()` (both required in RedBark's
    `AccountItem`).
  - `src/domain/cdr/map-redbark.ts` — pure `latestBalance(balance): { amount, asOf } | null`:
    dollars (`current.amount ÷ 100`) and `observed_at`. Null when either is null or the
    currency isn't AUD, so an unreadable or foreign balance never overwrites the saved one.
  - `src/server/cdr/cdr.redbark.ts` — `listBalances(accountIds)` replaces `getAccountBalance`:
    one `GET /v2/balances?account=…&account=…` (RedBark's bulk read, mid tier, up to 100 ids,
    answers in the order asked), parsed with `redbarkPageDto(redbarkBalanceDto)`. An account
    RedBark can't reach comes back `freshness: unavailable` with a null `current`; it doesn't
    fail the call.
  - `src/server/cdr/cdr.repository.ts`:
    - `DiscoveredAccount` and `upsertAccount` take `institutionName` and `accountNumber`; the
      insert and the `set` both write them.
    - `recordBalance(accountId, { amount, asOf })` sets `balance` and `balanceAsOf`.
    - `setNickname(accountId, nickname)` sets one row's `nickname` and returns the row, or
      `undefined` when no row has that id.
  - `src/server/cdr/cdr-sync.service.ts`:
    - Discovery passes `institution.name` and `account_number`.
    - After the account loop, one `listBalances` call for every listed account on a live
      (`active` / `expiring`) connection, none when there are none: a dead bank can't answer,
      and a call where no bank answers fails. Each non-null `latestBalance` → `recordBalance`. A throw here logs `error` and never fails
      the run; the anchor then has nothing to read and skips.
    - The anchor reuses that reply for its counted accounts (step 1 below). A counted
      account missing from it skips the anchor with `logger.info`.
  - `src/domain/cdr/cdr.dto.ts` — `cdrSetNicknameDto = z.object({ accountId:
    z.string().min(1), nickname: z.string().trim().max(40) })`, transformed so blank → null
    (back to the bank's name). Export it from `index.ts`.
  - `src/server/cdr/cdr.service.ts` — `setNickname({ accountId, nickname })` →
    `NotFoundError` when the repository returns `undefined`.
  - `src/server/cdr/cdr.trpc.controller.ts` — `setNickname:
    protectedProcedure.input(cdrSetNicknameDto).mutation(...)`.
  - adr017 — facet 5 names the five columns; the diagram's balance edge becomes the bulk
    `GET /balances`.
- **Settings → Bank accounts** (`src/app/(dashboard)/settings/_components/`), prototype D:
  - `src/components/ui/switch.tsx` — the shadcn Switch (Base UI), added with
    `pnpm dlx shadcn add switch`. The light off track is `bg-muted-foreground/80`, not
    `bg-input`: shadcn's is ~1.35:1 on a card, under WCAG 1.4.11's 3:1 (design review).
  - `bank-accounts.display.ts` — pure helpers:
    - `accountLabel` — the nickname, else the bank's name, else the id.
    - `groupByBank` — groups by `institutionName` (A–Z), each group's rows by balance high →
      low (no balance last), with its counted count. By balance, not by switch, so a row
      never moves mid-flip.
    - `cashTotal` — Σ counted balances; null while any account is undecided.
    - `formatBalance` — money with a real minus sign (`−$8,394.25`).
    - `newAccountsNote` — "{n} new account(s) need(s) a choice. Find it/them marked New
      below.", or null. Rows sort by balance, so a new one can sit below the fold.
  - `bank-account-row.tsx` — props-driven `BankAccountRow({ account, onInBalanceChange,
    onRename })`, one `<li>`:
    - The label with a pencil button ("Rename {label} {number}"). The pencil opens an inline
      form: input "New name for {label} {number}" (placeholder the bank's name, max 40),
      **Save** / **Cancel**. Enter saves, Escape (anywhere in the form) cancels, and focus
      returns to the pencil. Saving blank clears the nickname.
    - Under it: the masked number (mono), the bank's account name when nicknamed, and for an
      undecided account "New — switch on if it's cash, or leave it out", where "leave it out"
      is a button that sets false and moves focus to the switch (the button goes with the
      hint). An undecided row gets an amber left border.
    - The balance (right, tabular, "—" before the first read): greyed when not counted,
      struck through when left out. The name and number never grey: the account still syncs.
    - A `Switch` at the far right, named "Count {label} {number} in cash balance", on only
      when the flag is true, described by the New hint while undecided. No account type chip.
  - `bank-accounts-section.tsx` — `useSuspenseQuery` on `api.cdr.syncState` inside
    `SettingsSection` titled "Cash balance" (the tab stays "Bank accounts"): "Your cash balance
    adds up every account switched on. Switched-off accounts still sync, they just aren't
    counted."
    - `newAccountsNote` in a warn box under the description, when any account is undecided.
    - Per bank: a heading with "{n} of {m} counted" over a card list of rows.
    - A Total row under the groups, lined up with the balances: `cashTotal` and "{n} of {m}
      accounts counted"; "—" and "Waiting on {n} new account(s)" while any is undecided.
    - Footer "Recounted at the next bank sync." Empty list → "No bank accounts yet. They show
      here after the first bank sync."
    - `setInBalance` and `setNickname` update the `cdr.syncState` cache at once (cancel the
      in-flight read, patch the row, then mutate; `onSuccess` puts the saved row in, `onError`
      invalidates), so the switch, the counts and the Total move with no wait. Two quick flips
      don't flicker, as no refetch lands between them. A server error is the global
      MutationCache's job.
  - `settings-panel-skeleton.tsx` — `BankAccountsSkeleton` in the same shape: title "Cash
    balance", one bank group of three rows (name, number, balance, switch), the Total row.
  - `settings-view.tsx` — `SectionId` (`:21`) gains `"bank-accounts"`; add a `sections` entry
    (`:34-63`) labelled "Bank accounts" with the `Landmark` icon, wrapped in `AsyncBoundary
    label="bank accounts"`. Update the `PageHeader` description (`:91`) to mention bank
    accounts.
  - `settings/page.tsx:26-27` — add `void api.cdr.syncState.prefetch();`.
  - **Remove the prototype**: `bank-accounts.prototype.tsx`, `src/components/prototype-switcher.tsx`
    and the `?variant=` hook in `settings-view.tsx`.
- `src/domain/balances/balance.interface.ts` — add `source: BalanceSource` (forced by
  `schema-interface-contract.test.ts:25`). `balance.dto.ts` is **unchanged**: `balanceSetDto`
  stays `{ amount, asOf }`, so a member can't post `source`.
- `src/server/balances/balances.repository.ts` — `insert` (`:9`, `:33-39`) takes
  `BalanceSetInput & { source: BalanceSource }`.
- `src/server/balances/balances.service.ts`:
  - `set` (`:21-23`) passes `BalanceSource.Manual`.
  - New `recordSynced(input: BalanceSetInput)` passes `BalanceSource.Cdr`.
- `src/server/balances/balances.module.ts` — new. It exports one shared `balancesService`,
  because the worker root now needs it too. `services.ts:15-17` imports it instead of building
  it, and `cashflow` keeps receiving the same instance. Add it to the module list in
  `.claude/rules/server-architecture.md`.
- `src/domain/cdr/map-redbark.ts` — pure `anchorFromBalances(balances): { amount, asOf } | null`.
  It returns null when the list is empty or **any** balance isn't `freshness: "fresh"` or has a
  null `current` / `observed_at` (the DTO allows both).
  Otherwise `amount` = Σ `current` ÷ 100 (settled ledger, not `available`) and `asOf` = the
  oldest `observed_at`. Non-AUD throws.
- `src/server/cdr/cdr-sync.service.ts` — add dep `balances: Pick<BalancesService,
  "recordSynced">`. After the account loop, before `run()` throws for a failed account, and
  only when no **counted** account failed, **no account's `inBalance` is still null, and every
  counted account (`inBalance` true) is syncable** (`active` / `expiring`, account `available`).
  Each flag is the saved one, read by `listSyncState()` after discovery, never
  `inBalanceByDefault`: `coalesce` keeps a member's Bank accounts choice in the row, so a
  card set to false stays out.
  A closed counted account holds the anchor until set to false. A failed loan doesn't
  block it: a loan's rows breaking the sign check every day would otherwise hold the cash line
  for good. A retried run may write the anchor again; latest `asOf` wins, so the repeat is
  harmless. A null flag, or a counted account with a dead or pending consent or not
  `available`, skips the anchor with `logger.info`: dropping it would shrink the sum while
  every balance read still passes the freshness gate (a savings account under an odd type
  name). An account with `inBalance` false is ignored here, so a pending loan never blocks the
  cash line.
  1. Take each counted account's balance from the run's one `listBalances` reply.
  2. Call `anchorFromBalances`.
  3. Non-null → `balances.recordSynced(...)`; null → `logger.info` and skip.
  A throw anywhere in this step (a non-AUD balance, `recordSynced`) skips the anchor with
  `logger.error` and never fails the run.
  A retry would re-fetch every account's transactions, so a 429 here would only draw more 429s;
  the next daily run anchors.
  `functions.ts` passes `balancesService`.
- `src/app/(dashboard)/_components/balance-snapshot.display.ts` — pure
  `balanceSourceLabel(source)` ("Synced from bank" / "Entered by you").
  `balance-snapshot-card.tsx:55-57` shows it after "As of …".
- Cashflow is untouched: `cashflow.service.ts:73-75` passes only `amount` / `asOf`, and the
  pivot maths (`cashflow.ts:271-304`) is unchanged.
- Tests:
  - `balances.schema.test.ts` — `source` defaults to `manual`.
  - `balances.repository.test.ts` — the `SNAPSHOT` fixture (`:26-31`) and both inline SQL
    snapshots (`:53`, `:80`) gain `source`.
  - `balances.service.test.ts` — `set` stamps `manual`; `recordSynced` stamps `cdr`.
  - `balances.trpc.controller.test.ts` — a `source` key posted to `set` never reaches the
    service.
  - `map-redbark.test.ts` — all fresh → sum + oldest `observed_at`; a credit card's negative
    `current` lowers the sum; any stale → null; a fresh balance with a null `current` or
    `observed_at` → null; empty → null. `inBalanceByDefault`:
    `transaction` / `savings` / `credit-card` → true, `loan` → false, any other type → null.
  - `cdr.dto.test.ts` — an account parses with `type`; an unseen type string still parses.
  - `cdr.schema.test.ts` — `inBalance` is nullable with no default.
  - `cdr.repository.test.ts` — the `upsertAccount` snapshot sets
    `coalesce("inBalance", excluded."inBalance")`.
  - `cdr-sync.service.test.ts`:
    - Discovery passes each account's default flag; a null flag logs `warn` with its type.
    - One anchor when every counted account is fresh, summing counted accounts only. An
      account with `inBalance` false is never read, even when it is `pending` or
      `unavailable`.
    - A `credit-card` account whose saved flag is false is never read and left out of the
      sum.
    - Any account with a null `inBalance` skips the anchor with `logger.info`, even when every
      counted account is fresh.
    - No anchor when a counted account is stale, `revoked` / `expired` / `invalidated` /
      `pending`, or listed `syncing` / `unavailable`, or when a counted account failed.
    - An `inBalance` false account that fails still gets the anchor written, then `run()`
      throws its `CdrSyncError`.
    - A throwing `listBalances`, a non-AUD balance, or a throwing `recordSynced` each log an
      error, write no anchor, and `run()` resolves.
    - Discovery passes each account's `institution.name` and `account_number`.
    - One `listBalances` call per run, for every listed account on a live connection (none
      when there are none). Each readable balance is
      saved with `recordBalance`; an unavailable one (null `current`) is not. The anchor sums
      from that same reply and makes no second read.
    - A counted account missing from the reply skips the anchor with `logger.info`.
  - `balance-snapshot.display.test.ts` — the label for each source.
  - `cdr.repository.test.ts` — inline snapshot of `setInBalance`: one `update` filtered on
    `accountId`, `returning`.
  - `cdr.dto.test.ts` — `cdrSetInBalanceDto` refuses an empty `accountId` and a non-boolean.
  - `cdr.service.test.ts` — `listSyncState` delegates; `setInBalance` passes through and
    throws `NotFoundError` for an unknown account.
  - `cdr.trpc.controller.test.ts` — `createTestCaller` with `Partial<CdrService>` (pattern
    `balances.trpc.controller.test.ts:9-58`). Both procedures call the service; a signed-out
    call gets `UNAUTHORIZED`; an unknown account gets `NOT_FOUND`.
  - `cdr.dto.test.ts` — an account parses with `institution.name` and a null
    `account_number`; `cdrSetNicknameDto` trims, turns blank into null, and refuses 41
    characters and an empty `accountId`.
  - `cdr.schema.test.ts` — the five new columns are nullable with no default.
  - `cdr.repository.test.ts` — the `upsertAccount` snapshot writes `institutionName` and
    `accountNumber` in the insert and the `set`, and never names `nickname`; inline snapshots
    of `recordBalance` and `setNickname`.
  - `cdr.redbark.test.ts` — `listBalances` makes one GET with `account` repeated in the order
    given and parses an unavailable item with a null `current`. The `getAccountBalance` tests
    go with it.
  - `map-redbark.test.ts` — `latestBalance`: dollars and `observed_at`; null for a null
    `current`, a null `observed_at`, or a non-AUD currency.
  - `cdr.service.test.ts` — `setNickname` passes through and throws `NotFoundError` for an
    unknown account.
  - `cdr.trpc.controller.test.ts` — `setNickname` calls the service with the trimmed input;
    an unknown account gets `NOT_FOUND`.
  - `bank-accounts.display.test.ts` — the label (nickname, then the bank's name, then the
    id); banks A–Z with rows by balance high → low and no balance last, and each bank's
    counted count; the total sums counted balances only and is null while any is undecided;
    the minus sign.
  - `bank-account-row.test.tsx` (jsdom), queried by role — the switch is on only for true;
    flipping it calls `onInBalanceChange` with the new value; an undecided row shows the New
    hint and "leave it out" calls `onInBalanceChange(false)`; pencil, type, Enter calls
    `onRename` with the text; Escape cancels with no call; a nicknamed row shows the bank's
    name under it.

### Success
- [x] `make check` passes (incl. `db:check` and the contract)
- [x] `make test` passes
- [x] `/design-review` (balance card gains the source label)
- [x] `/design-review` (Settings → Bank accounts, prototype D)
- [x] A live card balance with money owing reads negative; noted in adr017 facet 6
- [x] A sync writes exactly one `cdr` snapshot summing only `inBalance` accounts: a credit
      card's balance lowers it and a loan is left out. A stale counted account, one with a
      dead consent, or any account still undecided (null) leaves the balance line unchanged
- [x] A sync makes one `GET /balances` call and no per-account balance reads
- [x] After a sync, every account on `/settings` → Bank accounts shows under its bank with its
      masked number and latest balance; the three "Everyday Offset" accounts differ by number
- [x] Flipping a switch moves the bank's "n of m counted" and the Total at once, with no
      reload; the flag is saved
- [x] Switching a card off drops it from the next anchor, and a later sync doesn't flip it back
- [x] Off greys and strikes through only the balance; the name and number keep full colour
- [x] An undecided account shows the amber border and the New hint, and the Total shows "—";
      "leave it out" saves it off and clears both
- [x] A renamed account shows the new name with the bank's name under it, and a later sync
      keeps it; saving blank goes back to the bank's name
- [x] No prototype code left in the tree: `bank-accounts.prototype.tsx`,
      `prototype-switcher.tsx` and the `?variant=` hook are gone
- [x] `scripts/cdr-in-balance.ts` and the `cdr_in_balance` target are gone; nothing in `src/`,
      `docs/` or the `Makefile` names them
- [x] A typed `balance.set` shows until the next sync writes a newer `cdr` row (source is a
      label only)

Verified 2026-10-20 on the branch DB:
- Live sync: discovery set 8 `transaction` + 2 `credit-card` accounts true and the `loan` false.
  The one `cdr` row equals Σ counted `current`, with `asOf` = the oldest counted `observed_at`.
- A card set false stayed false through a re-sync, and the next anchor left it out (set with the
  since-removed `make cdr_in_balance`; the Bank accounts check above repeats it in the UI).
- A local RedBark proxy (one account bent per run) showed no new row and logged the skip reason
  for: an unknown type (undecided), a `stale` balance, and a `revoked` connection.
- A sync whose oldest bank read was older than a just-typed balance left "Entered by you" showing.
  Once the typed row was older, the card read "Synced from bank".
- Extra skip reason from the build: "no account counts" (every flag false), so it never logs "not fresh".

Verified 2026-10-21 on the branch DB (Bank accounts, prototype D):
- After a sync all 11 accounts show under CommBank, MyCard and Westpac with their masked number
  and balance; the 3 "Everyday Offset" rows differ by number. Total $61,905.10 = the dashboard
  anchor.
- MyCard Premier switched off → an invoked `cdr-sync` kept it off and wrote a `cdr` row of
  70,299.35 (its −8,394.25 left out). Switched back on and re-synced: 61,905.10.
- Renamed "Smart Access" to "Bills"; an invoked sync kept it. Saving blank went back to
  "Smart Access".
- No account is undecided live, so null was faked in the client cache: amber edge, New hint, top
  note and a "—" Total showed. "leave it out" saved false and moved focus to the switch.

Design review 2026-10-21 (prototype D), fixed:
- The light-mode off switch was ~1.35:1 on the card → track `bg-muted-foreground/80` (3.6:1).
- A new account could sit below the fold → a warn note under the description
  (`newAccountsNote`).
- The switch read the same "off" for an undecided row → `aria-describedby` the New hint.
- "leave it out" dropped focus to the page → focus moves to the row's switch.
- Escape only worked in the rename input → handled on the form; the input is named per row
  ("New name for {label} {number}").
- The skeleton list lacked `overflow-hidden`.

Rechecked live at 375 and 1440.

### Follow-up (not built)
Not needed for this phase's Success. Pick up when this page is next touched.
- Strike-through on an off debt covers the "−", so −$8,394.25 reads like a positive amount.
  Leave the sign unstruck (`bank-account-row.tsx`).
- Tap targets under 44px at 375: switch 54×32, pencil 30×30, Save / Cancel 24px tall and ~7px
  apart, "leave it out" 16px tall.
- The switch focus ring (3px at 50% alpha) is faint around the off track
  (`src/components/ui/switch.tsx`).
- Nothing is read out on a rename save, on "leave it out", or when the Total changes (a polite
  live region on the Total).
- The empty state gives no next step: say where to connect a bank (RedBark's dashboard).
- Rows jump when the rename form opens (+8px desktop, +20px at 375) and when the New hint goes
  at 375 (+31px).
- The Total's `w-8` spacer and the skeleton's switch pill copy the switch's size, so they drift
  if it changes.
- On a phone the "Bank accounts" tab starts off-screen in the settings tab rail; only a half-cut
  tab hints that it scrolls (`settings-view.tsx`).
- The global error toast shows raw error text (`src/trpc/query-client.ts`).

---

## Phase 6: Connection-status banner

Completes the consent-lifecycle surfacing (adr017 credential posture). Reads `api.cdr.syncState`
from Phase 5.

**Revised 2026-10-20.** The `make cdr_seed` script that lived here is gone. History now comes
from the import (Phases 7–8), so nothing has to run before the key is set.

### Changes
- `src/app/(dashboard)/_components/cdr-connection.display.ts` — pure
  `connectionNotice(states: CdrSyncState[])`:
  - Returns `null` when nothing needs attention: no accounts, or all `active` / `pending` with
    no `lastError`.
  - `expiring` → `{ tone: "warn", … }`: a soft warning.
  - An account with `lastError` → `{ tone: "warn", … }` naming it and its `lastSyncedAt`
    ("hasn't synced since …", or "yet" when null), never the error text. Otherwise a stuck
    account (a row the mapper rejects, or one RedBark no longer lists) leaves its numbers old
    with nothing on screen; the logs carry the cause.
  - `expired | revoked | invalidated` → `{ tone: "alert", … }`. It names the accounts and tells
    the member to **reauthorize** the connection in RedBark's dashboard, not link the bank
    afresh. Reauthorizing "renews the existing connection in place: the connection keeps its id
    and its accounts" (`reauthorize_connection`, `https://api.redbark.com/v2/openapi.json`). So
    the next run sees it `active`, the banner clears, and each account resumes from its saved
    mark. A fresh link makes new ids, which start a new 14-day window; the gap comes back with
    an import (see the re-link runbook).
  - When both kinds are present, alert wins.
- `src/app/(dashboard)/_components/cdr-connection-notice.tsx` — props-driven
  `CdrConnectionNotice({ notice })`, no data calls. It shows a `role="status"` (warn) or
  `role="alert"` (alert) banner:
  - Tokens: `--badge-warn-*` / `--badge-spend-*` (`src/styles/globals.css:78-90`).
  - Shape: like `MatchBanner` (`src/app/(dashboard)/receipts/_components/receipt-detail.tsx:89-213`).
- `src/app/(dashboard)/_components/cdr-connection-banner.tsx` — async **server** component
  `CdrConnectionBanner`, built like `StatCards` (no client query, no prefetch, no
  `HydrateClient`). It awaits `api.cdr.syncState()` (`~/trpc/server`), runs
  `connectionNotice`, and renders nothing for `null`, else `CdrConnectionNotice`. The banner
  carries its own top margin, since it usually renders nothing.
- `src/app/(dashboard)/page.tsx` — mount
  `<AsyncBoundary label="bank connections" skeleton={null}><CdrConnectionBanner /></AsyncBoundary>`
  between `PageHeader` (`:15-18`) and the summary section (`:22-26`). The invisible gate
  (adr027) shows nothing while loading, and a failed read hides the banner (still logged)
  instead of putting an error card above the page. Dashboard only: `(dashboard)/_components/`
  is the home page's folder (`.claude/rules/ui-components.md`).
- **Unplanned:** synced Spend with no `expenseId` already lands in the queue
  (`transactions.repository.ts:267-291`: `amount > 0 AND expenseId IS NULL`). Verify; no new
  surface (adr017 Positive Consequences).
- Tests:
  - `cdr-connection.display.test.ts` — each status → its notice; an `active` account with
    `lastError` → warn naming it and its last sync date, not the error text; mixed → alert wins;
    empty → null.
  - `cdr-connection-notice.test.tsx` (jsdom) — a warn notice renders `role="status"`, an alert
    notice renders `role="alert"` with the account names and the reauthorize copy (queried by role
    and text).

### Success
- [x] `make check` passes
- [x] `make test` passes
- [ ] `/design-review` (connection-status banner)
      — run 2026-10-22, no blockers, one High open: the banner streams in after the sections
      and pushes the page down (CLS 0.123 at 375, 0.060 at 768, 0.037 at 1440; 0 with no
      banner). Contrast passes both tones and themes. Fix, then re-run.
- [x] A `revoked` connection shows the reauthorize banner and its accounts stop syncing; an
      `expiring` one shows a soft warning; no banner shows with no linked accounts
      — 2026-10-22, DB flips on the branch: `revoked` → `role="alert"` reauthorize banner
      naming the account; `expiring` → `role="status"` "Bank connection expiring"; a
      `lastError` → "Bank sync is behind … since 21 Oct 2026", no error text; revoked +
      `lastError` → alert only. All healthy → no banner. Empty list and the sync skip rest on
      unit tests (`connectionNotice([])`, Phase 4 consent tests, Phase 5 proxy check).
- [x] A failing `cdr.syncState` read hides the banner; the header and every other section
      still render
      — 2026-10-22, table renamed with a `revoked` row in it: no banner, header + summary +
      cash flow + spending render, the failed query is logged.
- [x] *Unplanned:* 296 synced Spend rows (30 days) have no `expenseId`; `findUnplanned` has no
      provenance filter, so they land in the queue.

Open from validation 2026-10-22 (see `/resolve-findings`):
- **Wrong day.** The banner is a server component, so `formatDate(lastSyncedAt)` runs in the
  server's zone (UTC on Vercel). The 18:00 UTC cron is the next morning in Sydney, so "since"
  reads a day early.
- **Layout shift** (design review High, above).
- `role="alert"` re-announces a lasting state on every visit; use `status` for both tones.
- Copy: no RedBark link; plural lists use "it"; same-named accounts can't be told apart;
  an alert hides other banks' warn lines; expiring + stuck loses the expiry title.
- Duplicates: `DEAD` copies `DEAD_CONSENT` (`cdr-sync.service.ts:23`); `accountLabel` copies
  `settings/_components/bank-accounts.display.ts:12`.
- A cold first dev load logs Next's "unstable `Date.now()` while prerendering" at
  `page.tsx:24` (`flushAfterResponse` before `headers()`). Gone on reload; `make build` is
  clean. Check whether `await io()` in the banner (as `cash-flow-section.tsx:16`) clears it.

---

## Phase 7: Bank-row matching (adopt + possible duplicates)

Revises adr017 facets 2 and 5 (added 2026-10-20). Backend only; the review UI is Phase 8. Every
bank row, from the daily sync or an import, goes through one reconcile step in the transactions
domain. That makes a re-run of any window safe: it adds only rows that are missing, and it
never deletes.

**The rules** (agreed 2026-10-20):
1. **Known bank id** (`provenance` + `externalId` already in `transaction`) → refresh its
   bank-owned columns, as `upsertSynced` does today.
2. **Pending review** for that bank id → refresh the review's bank values. Never a second
   review, never a row. **Kept** review → skip; the member already said no.
3. **Exact** → **adopt**. A household row (`externalId` null) on the same calendar day with the
   same amount to the cent takes the bank's `provenance`, `externalId`, `externalAccountId`
   and `accountName`. Its description, Expense link, Category, Group, notes and receipt stay,
   and its id doesn't change. It is now non-`manual`, so the Phase 3 guard locks its date and
   amount.
4. **Close** → **possible duplicate**: same sign, amount within 5% of the household row's
   amount, and no more than 7 calendar days apart. A `possible_duplicate` row holds the bank
   row; nothing is written to `transaction`.
5. Otherwise → **add** the bank row.

Who can be a candidate:
- A household row with no `externalId` that no pending review already holds.
- A bank row from an account RedBark no longer lists (a re-link; see Validate), with
  `externalAccountId` set and not in this run's `liveAccountIds`. **Review only**, never
  adopted: one tap moves it to the new id ("Use bank's").
- Never a bank row from a listed account, so two real same-amount coffees from one card never
  match each other.

Pairing is greedy and one-to-one: exact pairs first, then close pairs by (day gap, amount gap,
candidate id). A bank row or candidate is used once; an unpaired bank row is added.

Days compare as calendar days in `Australia/Sydney`. Bank rows are stored at UTC midnight, but
a row typed in the form is stored at local midnight (`submitted-date.ts:3-7`), which is the day
before in UTC. One household with AU banks (CDR, AUD-only), so one fixed zone; it becomes a
setting with household scoping (Out of Scope).

### Changes
- `src/lib/constants.ts`:
  - `export enum PossibleDuplicateStatus { Pending = "pending", Kept = "kept" }`
  - `export const HOUSEHOLD_TIME_ZONE = "Australia/Sydney"`
- `src/lib/utils.ts` — `dayKeyInZone(value: Date, timeZone: string): string` (`YYYY-MM-DD`),
  built on `zonedDayFormatter` (`:88-104`), beside `startOfDayInZone` (`:106-118`).
- `src/server/transactions/transactions.schema.ts`:
  - `transaction` gains `externalAccountId` (text, null) after `externalId` (`:47`). RedBark's
    account id, so a re-linked account's old rows can be told apart.
  - pgEnum `possible_duplicate_status` from `PossibleDuplicateStatus`.
  - Table `possible_duplicate` (this domain's; adr022):

    | Column | Type |
    | --- | --- |
    | `id` | identity PK |
    | `transactionId` | integer, not null, FK `transaction.id` **on delete cascade** (the member deleting their row drops the question; the bank row comes back on the next run or import that covers it) |
    | `provenance` | `transaction_provenance`, not null |
    | `externalId` | text, not null |
    | `externalAccountId` | text, not null |
    | `accountName` | text, not null |
    | `amount` | double precision, not null |
    | `date` | timestamptz, not null |
    | `description` | text, not null |
    | `status` | enum, not null, default `pending` |
    | `createdAt` | timestamptz, not null, `$defaultFn` (as `transaction`) |
    | `updatedAt` | timestamptz, null, `$onUpdate` |

    `uniqueIndex("possible_duplicate_external_idx").on(provenance, externalId)`: one question
    per bank row, ever. `index("possible_duplicate_transaction_idx").on(transactionId)`.
- `src/domain/transactions/transaction.interface.ts`:
  - `Transaction` gains `externalAccountId: string | null`; `SyncedTransaction` (`:24-32`)
    gains `externalAccountId: string`.
  - `PossibleDuplicate` (the row; add the pair to `schema-interface-contract.test.ts`
    `Contracts`, `COVERED` and `aligned`).
  - `PossibleDuplicateReview` (read model): `{ id, bank: { date, amount, description,
    accountName }, mine: Pick<Transaction, "id" | "date" | "amount" | "description" |
    "accountName" | "provenance"> }`.
  - `ReconcileCounts { added, adopted, flagged, known }`. `known` counts refreshed rows and
    skipped `kept` ones.
- `src/domain/transactions/transaction.dto.ts` — `resolveDuplicateDto = z.object({ id:
  z.number().int().positive(), choice: z.enum(["keep_mine", "use_bank", "both_real"]) })`.
- `src/domain/cdr/map-redbark.ts:33-41` — set `externalAccountId: row.account`
  (`cdr.dto.ts:18`).
- `src/domain/transactions/reconcile-synced.ts` — pure `planReconcile({ incoming, knownIds,
  reviews, candidates, liveAccountIds, timeZone })` → `{ refresh, add, adopt, flag, skipped }`,
  with `MATCH_DAYS = 7` and `MATCH_SHARE = 0.05`. It applies the rules and pairing above. Amounts
  compare as whole cents (`Math.round(amount * 100)`), because `amount` is a double. A
  retired-account candidate can only be flagged. Export it from `src/domain/transactions/index.ts`.
- `src/server/transactions/transactions.repository.ts` (interface `:61-86` + class):
  - `upsertSynced` (`:226-241`) `set` gains `externalAccountId`, so a refresh fills it on rows
    synced before this phase.
  - `findKnownExternalIds(provenance, externalIds)` → `string[]`.
  - `findReviews(provenance, externalIds)` → `{ id, externalId, status, transactionId }[]`.
  - `findMatchCandidates({ from, to, liveAccountIds })` — `date` in `[from, to)`, and either
    `externalId is null` or `externalAccountId` set and not in `liveAccountIds`, and no
    `pending` review holds it (`not exists`).
  - `applyReconcile({ upserts, adoptions, flags })` — one `db.transaction` (both tables are
    this domain's):
    - The `upsertSynced` statement for refreshes and adds.
    - One `update` per adoption, guarded `where id = $id and "externalId" is null`, so a row
      claimed since the read is left alone (that bank row then waits for the next run).
    - `insert into possible_duplicate … on conflict (provenance, "externalId") do update set`
      the bank values `where status = 'pending'`, so a `kept` review never reopens.
  - `listPendingDuplicates()` (joined to the household row, newest bank date first) and
    `countPendingDuplicates()`.
  - `keepMine(id)`, `useBanks(id)`, `bothReal(id)` — each in a `db.transaction`, each acting
    only on a `pending` review, each returning whether it found one:
    - keep → `status = kept`.
    - use bank's → set the household row's `date`, `amount`, `provenance`, `externalId`,
      `externalAccountId`, `accountName` from the review, then delete the review.
    - both → insert the bank row (`on conflict do nothing`), then delete the review.
- `src/server/transactions/transactions.service.ts`:
  - `reconcileSynced(rows, { liveAccountIds })` replaces `upsertSynced` (`:113-120`); its
    same-id dedupe moves here. Reads known ids, reviews, and candidates over `[oldest − 8d,
    newest + 9d)`: a day of slack each side, because a Sydney day starts the UTC day before (as
    `MATCH_SCAN_DAYS`, `src/domain/receipts/match.ts:16`); the planner keeps the exact 7.
    Calls `planReconcile` with `HOUSEHOLD_TIME_ZONE`, applies the plan, and returns
    `ReconcileCounts`. Empty `rows` reads and writes nothing.
  - `listPossibleDuplicates()`, `possibleDuplicateCount()`.
  - `resolveDuplicate({ id, choice })` → `NotFoundError` when no pending review has that id.
    A use-bank's unique violation (that bank id already sits on another row) →
    `ConflictError` ("That bank row is already in your transactions").
- `src/server/transactions/transactions.trpc.controller.ts` — `possibleDuplicates` and
  `possibleDuplicateCount` queries, and a `resolveDuplicate` mutation (`resolveDuplicateDto`).
- `src/server/cdr/cdr-sync.service.ts`:
  - Dep `transactions: Pick<TransactionsService, "reconcileSynced">` (`:41`, `:53`).
  - A null mark fetches `now − OVERLAP_DAYS` (14 days). Delete `BACKFILL_DAYS` (`:17`): older
    history comes from the import.
  - `syncAccount` (`:248-275`) calls `reconcileSynced(rows, { liveAccountIds })`, where
    `liveAccountIds` is every account id RedBark listed this run.
- `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` — rewrite facet 2 (one
  reconcile: refresh, adopt, possible duplicate, add) and facet 5 (14-day first run; history
  from the member's import; drop the seed and the 90-day backfill). Keep Status `In Progress`.
- `CONTEXT.md`:
  - **Adopt**: the bank sync takes a household Transaction as its own when a bank row has the
    same day and the same amount to the cent. The row keeps every Member edit; its date and
    amount then come from the bank. _Avoid_: link (an Expense), match (a Receipt), merge.
  - **Possible duplicate**: a bank row that looks like a household Transaction (same direction,
    within 5% and 7 days) but isn't exact, held until a Member keeps theirs, uses the bank's, or
    says both are real. _Avoid_: conflict, dupe.
  - Relationships: a Transaction is adopted by at most one bank row; a possible duplicate
    points at exactly one Transaction.
- `drizzle/0023_*.sql` — `make db_generate` + `make db_migrate`.
- Tests:
  - `src/lib/utils.test.ts` — `dayKeyInZone`: UTC midnight and Sydney local midnight of the
    same day give the same key, across a DST change.
  - `reconcile-synced.test.ts`:
    - A known id → refresh only, no candidate read needed.
    - Exact day and cent → adopt; a local-midnight household row matches a UTC-midnight bank
      row of the same day.
    - 3 days and 4% off → flag; 8 days off → add; 6% off → add; opposite sign → add.
    - Two bank rows and one candidate → one pairs, the other is added; an exact pair beats a
      closer-in-days near pair.
    - A pending review → refreshed flag, not re-matched; a kept review → skipped.
    - A retired-account candidate with the exact day and amount → flag, never adopt; a
      listed-account bank row is never a candidate.
    - Same input twice gives the same plan.
  - `transactions.repository.test.ts` — inline snapshots: the `upsertSynced` `set` with
    `externalAccountId`; `findMatchCandidates` filters; the guarded adoption `update`; the
    review upsert's `where status = 'pending'`; each resolve statement; the column-list
    snapshots gain `externalAccountId`.
  - `transactions.schema.test.ts` — `possible_duplicate` unique index, cascade FK, status
    default.
  - `transactions.service.test.ts` — `reconcileSynced` dedupes, calls `applyReconcile` with
    the plan and returns its counts; empty input does nothing. `resolveDuplicate`: each choice
    calls its repository method; not found → `NotFoundError`; a unique violation on use-bank's
    → `ConflictError`. An adopted row (now `cdr`) refuses an amount edit.
  - `transactions.trpc.controller.test.ts` — the three procedures call the service; a bad
    `choice` is refused before the service; signed-out → `UNAUTHORIZED`.
  - `map-redbark.test.ts` — `externalAccountId` comes from `row.account`.
  - `cdr-sync.service.test.ts` — a null mark fetches 14 days; `reconcileSynced` gets every
    listed account id; the "reconcile before advance" and "no advance on throw" cases move
    from `upsertSynced`.
  - Fixtures: add `externalAccountId` to the `Transaction` fixtures listed in Phase 1.

### Success
- [ ] `make check` passes (incl. `db:check` and the contract)
- [ ] `make test` passes
- [ ] On the branch DB, a manual row with the same day and amount as a bank row in the next
      run's window is adopted: it keeps its description, Expense link, Category and notes,
      shows the bank's account name, and refuses an amount edit. No second row appears
- [ ] A manual row 3 days and 2% off a bank row gets one pending possible duplicate and no new
      transaction; a second run adds no second review and no row
- [ ] Through `transaction.resolveDuplicate`: keep mine stays kept through the next run; use
      bank's gives the household row the bank's date and amount and keeps its links; both are
      real adds the bank row once. No transaction is ever deleted
- [ ] An account with no mark fetches only the last 14 days on its first run
- [ ] A run with nothing new leaves the transaction count unchanged

---

## Phase 8: History import page + job

Adds the member-run import (revised 2026-10-20) and the review screen. **Depends on Phase 7.**
A member picks a date range on `/transactions/import`. A background job pulls it from RedBark
in 90-day chunks and reconciles each one (Phase 7). The page shows progress and every pending
possible duplicate. A request can't fetch 7 years inside a page load, and RedBark caps a
window at 5,000 rows.

### Changes
- `src/lib/constants.ts` — `export enum CdrImportStatus { Queued = "queued", Running =
  "running", Done = "done", Failed = "failed" }`.
- `src/server/cdr/cdr.schema.ts` — pgEnum `cdr_import_status` and table `cdr_import` (cdr
  domain; adr022):

  | Column | Type |
  | --- | --- |
  | `id` | identity PK |
  | `fromDate` | timestamptz, not null (UTC midnight of the first day) |
  | `toDate` | timestamptz, not null (UTC midnight of the last day, inclusive) |
  | `status` | enum, not null, default `queued` |
  | `added`, `adopted`, `flagged`, `known` | integer, not null, default 0 |
  | `error` | text, null |
  | `createdAt` | timestamptz, not null, `.defaultNow()` |
  | `finishedAt` | timestamptz, null |
- `src/domain/cdr/cdr.interface.ts` — `CdrImport`; add the pair to
  `schema-interface-contract.test.ts`.
- `src/domain/cdr/cdr.dto.ts` — `cdrImportStartDto = z.object({ from: z.iso.date(), to:
  z.iso.date() })` (bare days from `<Input type="date">`).
- `src/domain/cdr/import-chunks.ts` — pure `importChunks(from, to, days = 90)` → inclusive
  `{ from, to }` windows covering the range with no gap or overlap; `IMPORT_MAX_YEARS = 7`.
- `src/server/cdr/cdr.redbark.ts` — `listTransactions` (`:26-29`, `:74-93`) takes an optional
  `to`, sent as a bare date like `from` (RedBark's `to` is inclusive).
- `src/server/cdr/cdr.repository.ts` — deps become `{ db, outbox: OutboxWriteDoor }` (as
  `receipts.repository.ts:68-80`). Methods:
  - `insertImport({ fromDate, toDate })` — `this.outbox.commit` inserts the row and
    `buildOutboxEvent("cdr/import.requested", { importId })` together (as
    `receipts.repository.ts:84-99`): the event needs the new id.
  - `findActiveImport()` (queued or running), `latestImport()`.
  - `markImportRunning(id)`, `addImportCounts(id, counts)` (adds to the columns),
    `finishImport(id)`, `failImport(id, message)`.
  - It now touches `cdr_sync_state` and `cdr_import` only.
- `src/server/inngest/events.ts` — `EVENT_REGISTRY` (`:13-17`) gains `"cdr/import.requested":
  z.object({ importId: z.number().int() })`.
- `src/server/cdr/cdr.service.ts`:
  - `startImport({ from, to })` → `InvalidInputError` when `from` is after `to`, `to` is after
    today, or `from` is more than 7 years ago ("today" in `HOUSEHOLD_TIME_ZONE`).
    `ConflictError("An import is already running")` when `findActiveImport()` finds one; two
    racing starts would only queue two runs, which the shared concurrency key runs one after
    the other. Then `insertImport`.
  - `latestImport()`.
- `src/server/cdr/cdr.trpc.controller.ts` — `startImport` mutation (`cdrImportStartDto`) and
  `latestImport` query.
- `src/server/cdr/cdr-sync.service.ts`:
  - Move discovery out of `run()` into a private method that both `run()` and `planImport` use.
  - `planImport(importId)` → `markImportRunning`. With no key, it calls `failImport(importId,
    "Bank sync isn't set up")` and returns no chunks. Otherwise it discovers, then returns
    `{ liveAccountIds, chunks }`: `importChunks` for each account the daily sync would sync
    (same consent and account-status rules). Dates travel as `YYYY-MM-DD` strings, because a
    step's result is JSON.
  - `importChunk(importId, chunk, liveAccountIds)` → `listTransactions({ accountId, from, to })`
    → map → `reconcileSynced` → `addImportCounts`. A retried chunk re-counts its rows as `known`,
    so counts are a guide, not a ledger.
  - `finishImport(importId)`, `failImport(importId, message)`.
  - An import never calls `advanceHighWaterMark` or the anchor.
- `src/server/cdr/cdr.inngest.controller.ts`:
  - `cdr-sync`'s `concurrency` becomes `{ limit: 1, key: '"cdr-sync"', scope: "env" }`.
  - Add `cdr-import` (`{ event: "cdr/import.requested" }`, `retries: RETRIES`, the same
    concurrency). Handler: `step.run("plan")`, then one `step.run(\`chunk-${accountId}-${from}\`)`
    per chunk, then `step.run("finish")`. Each step's error goes through the same mapping as
    `cdr-sync` (move it into one private method). `onFailure` calls `failImport` with the
    error message.
  - Before coding, confirm with `web-lookup` for `inngest` 4.22: `step.run` retries per step;
    `RetryAfterError` and `NonRetriableError` inside a step; the `onFailure` signature and how
    it reads the original event; that a shared `concurrency.key` holds a slot only while a step
    runs (so the cron can slip between import steps, but two reconciles never overlap); and
    the steps-per-run cap. 7 years is about 29 chunks per account. `planImport` fails the run
    with a clear message when the total would pass the cap.
  - `get functions()` returns `[this.sync, this.import]`.
- `src/server/inngest/functions.ts` and `src/server/api/services.ts` — build
  `new DrizzleCdrRepository({ db, outbox: outboxService })` (`outbox.module.ts`).
- `src/server/inngest/registry-golden.test.ts` — **deliberate** update: the
  `cdr/import.requested` key, and `{ id: "cdr-import", triggers: [{ event:
  "cdr/import.requested" }] }`.
- `.claude/rules/server-architecture.md` — add `cdr-import` and `cdr/import.requested` to the
  FROZEN list.
- **`/transactions/import` page** (`src/app/(dashboard)/transactions/import/`):
  - `page.tsx` — `AsyncBoundary` with `ImportSkeleton`, then an inner data component that
    prefetches `api.cdr.latestImport` and `api.transaction.possibleDuplicates` inside
    `HydrateClient` (as `expenses/unplanned/page.tsx:8-36`).
  - `_components/import-view.tsx` — `PageHeader` "Import from bank", with a link back to
    `/transactions`. Three parts:
    - `import-form.tsx` — From and To `<Input type="date">` (as `pay-cycle-section.tsx:55-67`),
      To defaulting to today, and an **Import** button. Disabled while a run is queued or
      running. Client checks from ≤ to; the server checks the rest, and its errors go to the
      global MutationCache. A line under it: "Safe to run again. It only adds what's missing,
      and it never deletes."
    - `import-status.tsx` — the latest run's status, range, counts ("Added 12 · Matched to
      yours 30 · To review 3 · Already here 950") and a failed run's error. Polls
      `api.cdr.latestImport` with `refetchInterval` while queued or running (as
      `receipts-view.tsx:192-198`). When it finishes, invalidate `transaction.possibleDuplicates`,
      `transaction.possibleDuplicateCount` and `transaction.list`.
    - `possible-duplicate-list.tsx` + props-driven `possible-duplicate-card.tsx` — "In Ledger"
      and "From the bank" side by side: date, description, amount, account. The day gap and
      amount gap are called out. Three buttons: **Keep mine**, **Use bank's**, **Both are
      real**, each calling `api.transaction.resolveDuplicate`. On success the card leaves and
      a toast says what happened. Empty → "Nothing to review."
  - `_components/import.display.ts` — pure status label, count line, and gap labels ("3 days
    later", "$1.20 more").
- `src/components/route-skeletons.tsx` — `ImportSkeleton` beside `TransactionsSkeleton`
  (`:145`).
- `src/app/(dashboard)/transactions/_components/transactions-view.tsx:144-152` — an "Import from
  bank" link button beside "Add transaction", with a badge from
  `api.transaction.possibleDuplicateCount` when it's above zero.
- `src/components/app-nav.tsx:36` — check that `/transactions/import` keeps Transactions
  active; prefix matching if not.
- Tests:
  - `import-chunks.test.ts` — one day; exactly 90 days → one chunk; 91 → two; 7 years → no gap
    or overlap, last chunk ends on `to`.
  - `cdr.dto.test.ts` — `cdrImportStartDto` refuses a non-date.
  - `cdr.redbark.test.ts` — `to` is sent as a bare date; left out when absent.
  - `cdr.repository.test.ts` — `insertImport` goes through `outbox.commit` with one
    `cdr/import.requested` event carrying the new id (fake outbox as in
    `receipts.repository.test.ts`); `addImportCounts` adds, not sets; `findActiveImport`
    filters queued and running.
  - `cdr.schema.test.ts` — `cdr_import` status default and count defaults.
  - `cdr.service.test.ts` — `startImport` refuses each bad range and an active import; a good
    one inserts.
  - `cdr.trpc.controller.test.ts` — both procedures call the service; signed-out →
    `UNAUTHORIZED`; an active import → `CONFLICT`.
  - `cdr-sync.service.test.ts` — `planImport` with no key fails the run and returns no chunks;
    it chunks only syncable accounts; `importChunk` passes `from`/`to`, reconciles with the
    live ids and adds counts; an import never advances a mark or writes an anchor.
  - `cdr.inngest.controller.test.ts` — `cdr-import`'s id, event trigger, retries and shared
    concurrency key; `cdr-sync` now has the same key. With a fake `step`, the handler runs
    plan, one step per chunk with a stable id, then finish; a step error maps like `cdr-sync`;
    `onFailure` calls `failImport`.
  - `import.display.test.ts` — each status label, the count line, gap labels for earlier,
    later, more and less.
  - `possible-duplicate-card.test.tsx` (jsdom) — both sides render; each button calls its
    handler with its choice; queried by role and name.

### Success
- [ ] `make check` passes (incl. `db:check` and the contract)
- [ ] `make test` passes
- [ ] `registry-golden.test.ts` pins `cdr-import` and `cdr/import.requested` (deliberate update)
- [ ] `/design-review` (`/transactions/import` and the header button)
- [ ] On the branch DB, importing a 30-day range finishes with counts; importing it again adds
      nothing and asks nothing new
- [ ] Importing a range that covers older manual rows adopts the exact ones, lists the close
      ones for review, and adds the rest; each review choice works from the page and the
      header badge drops to match
- [ ] Rows dated `from` match the bank statement for that day: none missing. The client sends
      `from` and `to` as bare dates (`cdr.redbark.ts:87`); a timestamp would be UTC midnight,
      10–11 am in Sydney, and drop that morning
- [ ] Starting while one runs is refused with a message; a `to` after today, or a `from` over 7
      years ago, is refused; with the key unset the run shows failed with a reason
- [ ] No import deletes a transaction (count before ≤ count after)
- [ ] A cron run that comes due during an import waits for the running step, then runs

---

## Phase 9: RedBark webhook trigger (final)

Implements adr017 facet 7's additive webhook trigger. **Prerequisite (adr017 Open Question):
confirm RedBark's `transactions.synced` / `connection.*` payload shapes, event-type names,
delivery-id headers, and signature schemes from RedBark docs/support before coding** — they are
unpublished today.

### Changes
- `src/server/inngest/events.ts`:
  - Add `cdr/sync.requested` (`z.object({})`) and `cdr/connection.changed` (`{ connectionId,
    status: z.enum(CdrConnectionStatus) }`) to `EVENT_REGISTRY` (`:13-17`). New keys only, no
    renames.
  - `buildOutboxEvent` (`:31-43`) takes an optional `{ id }` so a caller can supply a
    deterministic idempotency key. The default stays `crypto.randomUUID()`.
- `src/server/cdr/cdr.service.ts` — add dep `outbox: OutboxWriteDoor`, plus
  `requestSync(deliveryId)` and `connectionChanged(deliveryId, connectionId, status)`:
  - Both publish through `outbox.publish(buildOutboxEvent(name, …, { id: uuidFromDelivery(name,
    deliveryId) }))`. Never a bare `inngest.send`.
  - The outbox row's `uuid` PK (`outbox.schema.ts:12`) is the dedup store. A replayed delivery
    hits a unique violation. The service treats that as "already queued"
    (`isPgViolation(error, PgViolation.UniqueViolation)`, `src/server/errors/parse-error.ts:72`)
    and returns normally.
  - `uuidFromDelivery` = SHA-256 of `${name}:${deliveryId}`, formatted as a UUID. The two
    webhook sources sign differently and may number deliveries differently, so a bare id from
    one could match the other's and drop a real event as "already queued".
- `src/server/cdr/cdr.module.ts` — `CdrService` now has two consumers (the tRPC root and the
  webhook routes), so export one `cdrService` (`{ repository: new DrizzleCdrRepository({ db,
  outbox: outboxService }), outbox: outboxService }`). `services.ts` imports it. Add it to the
  module list in `.claude/rules/server-architecture.md`.
- `src/server/cdr/cdr.signature.ts` — `interface SignatureVerifier { verify(body, headers):
  boolean }` + two classes (`node:crypto` HMAC, `timingSafeEqual`, timestamp tolerance). They
  **must not be conflated** (adr017 facet 7):
  - `RedbarkWebhookVerifier` checks `X-Redbark-Signature: sha256=<hex>` over
    `<timestamp>.<body>`.
  - `RedbarkEventVerifier` checks the Stripe-style `Redbark-Signature: t=,v1=`.
- `src/server/cdr/cdr.http.controller.ts` — `class CdrHttpController` (deps `{ verifiers: {
  webhook, event }, service, logger }`), plain `Request` / `Response`. It has two route methods
  (as `receipts.http.controller.ts:113`, `:170`):
  - `webhook`: `transactions.synced` → `service.requestSync`.
  - `event`: `connection.*` → `service.connectionChanged`.

  Both read the raw body with `request.text()`. Gates (as `email.http.controller.ts:40-70`):
  - Bad or missing signature → 401, unlogged.
  - Signed but unreadable (bad JSON, a shape the DTO rejects, or no delivery id) → 200
    "ignored" + `logger.warn`. A retry sends the same bytes, and the daily cron still catches
    the sync or status it carried.
  - Signed but an irrelevant type → 200 "ignored".
  - Service error → logged and rethrown, so a 5xx earns a RedBark retry.
- `src/server/cdr/cdr.inngest.controller.ts`:
  - **One sync per burst, not per delivery.** RedBark sends one `transactions.synced` per
    account it refreshes. Each queued run fetches every account, so six deliveries would draw
    six full runs, past RedBark's 30/min transactions budget. Inngest documents `debounce` only
    for event triggers, so `cdr-sync` stays cron-only.
  - Add `cdr-sync-requested` (`{ event: "cdr/sync.requested" }`, `debounce: { period: "5m",
    timeout: "30m" }`, `retries: RETRIES`). Its handler calls the same `run()` through the
    shared error mapping (Phase 8).
  - It takes the shared `concurrency: { limit: 1, key: '"cdr-sync"', scope: "env" }` that
    Phase 8 gave `cdr-sync` and `cdr-import`, so a webhook run never overlaps either.
  - Add `cdr-connection-changed` (`{ event: "cdr/connection.changed" }`). Its handler reads
    `event.data.connectionId` / `event.data.status` by name (never spreads `event.data`) and
    calls a new `CdrSyncService.applyConnectionStatus` → `repository.setConnectionStatus`.
- `src/app/api/cdr/webhook/route.ts` + `src/app/api/cdr/events/route.ts` — each is its own
  composition root (per `src/app/api/receipts/inbound/route.ts:25-58`):
  - Read `REDBARK_WEBHOOK_SECRET` and `REDBARK_EVENT_SECRET`. When either is unset, return 500
    and `logger.error`.
  - A `compose()` memo builds `CdrHttpController` from `cdrService` and both verifiers.
  - `POST = withFlush(...)` returns `controller.webhook(request)` or `controller.event(request)`.
- `src/env.ts` + `.env.example` — add `REDBARK_WEBHOOK_SECRET` and `REDBARK_EVENT_SECRET`,
  server-only and optional.
- `src/server/inngest/registry-golden.test.ts` — **deliberate** golden update:
  - Add the two keys to the keys assertion (`:11-19`).
  - Append `cdr-sync-requested` and `cdr-connection-changed`.
- `.claude/rules/server-architecture.md` — add `cdr-sync-requested` and `cdr-connection-changed`
  to the FROZEN list.
- Tests:
  - `cdr.signature.test.ts` — known-vector HMACs. Each verifier accepts its own scheme and
    rejects the other's header, a stale timestamp, and a tampered body.
  - `cdr.http.controller.test.ts` — fake verifiers + fake service; call
    `webhook(new Request(…))` / `event(…)` (pattern `email.http.controller.test.ts:56-115`).
    Valid → 200 and the service is called; bad signature → 401 and the service is not called;
    signed bad JSON or no delivery id → 200 ignored, a `warn`, and the service is not called;
    irrelevant type → 200 ignored; service throw → rethrown.
  - `cdr.service.test.ts` — publishes through a fake outbox. The same delivery id gives the same
    event id; the same id under the other event name gives a different one. A unique violation
    resolves; any other error rethrows.
  - `src/server/inngest/events.test.ts` — `buildOutboxEvent` honours a supplied `id`.
  - `cdr.inngest.controller.test.ts` — extend for the two new functions. `cdr-sync-requested`
    has the debounce, and it shares the concurrency key with `cdr-sync` and `cdr-import`. Its
    handler calls `run()` and maps a `CdrSyncError` like `cdr-sync` does.
  - `route.test.ts` in each route dir — mock the tier modules and assert only the root's job:
    the env gate per secret, built once, delegates (pattern
    `src/app/api/receipts/inbound/route.test.ts:40-113`).

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `/security-review` (signature verification, `src/env.ts`, two public endpoints)
- [ ] RedBark payload, delivery-id and signature schemes are confirmed and cited in
      `cdr.signature.ts`
- [ ] A validly-signed `transactions.synced` delivery triggers a `run()`; a bad signature is
      rejected 401; a replayed delivery id is a 200 with no second run; a `connection.*` event
      flips `connectionStatus`
- [ ] Three `cdr/sync.requested` events sent within a minute from the Inngest dev server start
      one `cdr-sync-requested` run, about 5 minutes after the last

---

## Validate (whole branch)

- `/validate` runs `/code-review` over the full branch (standing step, not per-phase).
- Production enablement gate: do **not** set the production `REDBARK_API_KEY` until RedBark v2
  GA is confirmed (adr017 Open Question — beta `2026-10-01.wattle`). The optional key means the
  cron stays a safe no-op until then.
- Production setup order (no scripts):
  1. Migrations `0019`–`0024` deploy.
  2. Set `REDBARK_API_KEY` (and the webhook secrets once Phase 9 ships) as Vercel dashboard
     secrets. The first run fetches 14 days; the household's own rows in that window are
     adopted or flagged, never doubled.
  3. On `/settings` → Bank accounts, switch on or leave out any account marked New. The
     anchor waits until each is set.
  4. On `/transactions/import`, import the history wanted (up to 7 years), then resolve each
     possible duplicate.
- Re-link runbook. Reauthorize first: it keeps every id, so nothing else is needed. Only when
  RedBark refuses it (it answers `404` once an expired consent's data is deleted) link the bank
  afresh. Then:
  1. Delete the old account's `cdr_sync_state` row in the Neon SQL editor. RedBark no longer
     lists it, so it would fail every run as "not in RedBark" (Phase 4).
  2. On `/transactions/import`, import from the old account's newest synced day to today. The
     old account's rows are review-only candidates, so nothing is doubled: pick **Use bank's**
     to move each one to its new id.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — build stage 7
  (carries `## Related ADRs`)
- ADR: `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` (Status: In Progress). It
  was revised in place on 2026-10-09; Phase 2 records the sign result. It is implemented across
  all phases. Facet → phase map:
  - facet 1 (provenance model) → Phase 1
  - facets 3, 4 (settled-only, sign mapping) → Phase 2 (spike resolves Open Question #1)
  - facets 2, 5 (dedup upsert, `cdr_sync_state`; revised 2026-10-20 for adopt, possible
    duplicates and the import) → Phases 3, 4, 7, 8
  - facet 7 (poll-first / webhook-later) → Phases 4, 9
  - facet 6 (balance auto-anchor, `inBalance` scope resolved 2026-10-19, set on `/settings`)
    → Phase 5
  - credential & consent posture → Phases 2, 4, 6
- Composed with (Accepted):
  - `adr002` — outbox + Inngest rails
  - `adr004` — 3-tier
  - `adr005` — per-domain schema files
  - `adr013` — Terraform→Vercel env
  - `adr021` — `<domain>.<transport>.controller.ts`, tRPC router is the controller
  - `adr022` — cross-domain data through the owning service
  - `adr023` — `cdr/` is its own top-level domain
  - `adr027` — `AsyncBoundary` is the only loading region (Phase 5 Bank accounts, Phase 6
    banner, Phase 8 import page)
- Contrasts: `adr006` / `adr007` (inbound session creds), `adr014` (Bedrock OIDC creds).
- Rules: `.claude/rules/server-architecture.md` (tier map, construction, tests, FROZEN),
  `ui-components.md`, `unit-testing.md`.
- Terminology: `CONTEXT.md`:
  - **Provenance** (`:101-105`; column `provenance`, avoid "source")
  - **Spend** / **Inflow** sign convention (`:171-173`; positive `amount` = Spend)
  - **Unplanned** (`:33-36`)
  - **Group** vs **Category** (`:62-65`, `:96-99`)
  - **Transaction** (`:25-26`)
- Prior stage plans: `thoughts/plans/2026-09-01-expense-linking-stage-4.md` (rails),
  `thoughts/plans/2026-09-04-expense-linking-stage-5.md` (receipts),
  `thoughts/plans/2026-09-29-trpc-3-tier-step-1-foundation-transactions.md` …
  `2026-10-07-trpc-3-tier-step-7-receipts.md` (the migration this revision follows).
- Key existing code:
  - Transactions: `src/server/transactions/transactions.{schema,repository,service,trpc.controller,module}.ts`,
    `src/domain/transactions/transaction.{interface,dto}.ts`
  - Contract test: `src/server/db/schema-interface-contract.test.ts`
  - Architecture test: `src/server/architecture.test.ts`
  - Inngest: `src/server/inngest/{events,functions,middleware}.ts`,
    `src/server/inngest/registry-golden.test.ts`
  - Outbox: `src/server/outbox/outbox.{inngest.controller,service,repository,schema}.ts`
  - Receipts worker: `src/server/receipts/receipt-extraction.service.ts`,
    `src/server/receipts/receipts.{inngest.controller,http.controller,repository,module}.ts`
  - Email webhook: `src/server/email/email.{http.controller,mailbox}.ts`,
    `src/app/api/receipts/inbound/route.ts`
  - Balances: `src/server/balances/balances.{schema,repository,service,trpc.controller}.ts`
  - Cashflow: `src/server/cashflow/cashflow.service.ts`
  - Composition: `src/server/api/{services,root,trpc}.ts`, `src/server/db/index.ts`
  - Env: `src/env.ts`
  - UI: `src/app/(dashboard)/page.tsx`,
    `src/app/(dashboard)/_components/{balance-snapshot-card,cash-flow-section,stat-cards}.tsx`,
    `src/app/(dashboard)/_components/overview-data.ts`, `src/components/async-boundary.tsx`
