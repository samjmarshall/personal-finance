---
date: 2026-09-15
design: thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md
adrs: [adr002, adr004, adr005, adr013, adr017, adr021, adr022, adr023]
status: Validated - Phase 3 of 7
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
  (`transactions.service.ts:96-103`) → `DrizzleTransactionsRepository.insert`
  (`transactions.repository.ts:200-205`, inserts the DTO as-is). Member-editable fields are
  `transactionFields` (`src/domain/transactions/transaction.dto.ts:31-41`). The read type
  `Transaction` (`src/domain/transactions/transaction.interface.ts:3-20`) is pinned to the table
  by `src/server/db/schema-interface-contract.test.ts:28` — a new column without an interface
  field fails `make check`. Shared instance: `transactions.module.ts`. Only upsert precedent:
  `src/server/settings/settings.repository.ts:41` (`onConflictDoUpdate`).
- **adr022 owns cross-domain data.** A repository touches only its own domain's tables; other
  domains' reads *and* writes go through the owning service as a narrow `Pick` port.
  `src/server/architecture.test.ts` enforces it (TODO list empty, shrink-only): a
  `cdr.repository.ts` importing `transactions.schema` or `balances.schema` fails. No code runs
  one `db.transaction()` across two domains. Precedent for a repository holding another domain's
  port: `receipts.repository.ts:68-80` (`outbox: OutboxWriteDoor`), wired in
  `receipts.module.ts`.
- **Inngest rails.** Client `src/server/inngest/client.ts:17-22`. `EVENT_REGISTRY`
  `events.ts:13-17` (three `receipt/*` keys); `buildOutboxEvent` `:31-43` always mints a random
  uuid id. Worker root `functions.ts` (logger wiring `:26-35`, exported array `:41-44`), served
  by `src/app/api/inngest/route.ts` (`maxDuration = 300`, `:11`). Golden: keys
  `registry-golden.test.ts:11-19`, controllers built with `service: {} as never` `:37-38`,
  ids/triggers `:40-51`. Cron precedent `outbox.inngest.controller.ts:25-32` (sets no retries or
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
  `src/app/(dashboard)/page.tsx` is sync: `PageHeader` `:15-18`, then each section in its own
  `AsyncBoundary` (summary `:22-26`, cash flow `:28-32`, spending `:34-38`; spacing sits on a
  wrapper `div` outside each boundary). A section fetches
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
- **`cdr` code so far** (Phases 1–3): `src/domain/cdr/` (DTOs, `map-redbark.ts`,
  `cdr.interface.ts`), `src/server/cdr/cdr.redbark.ts`, `cdr.schema.ts` and `cdr.repository.ts`;
  `TransactionsService.upsertSynced` (`transactions.service.ts:113-119`). Latest migration is
  `drizzle/0020_wise_penance.sql`.
- **Scripts.** One TS script exists: `scripts/blob-prefix-delete.ts` (Node type stripping, run
  by `make db_branch_delete`). It imports app code; Phase 5/6 scripts don't.

## Desired End State

A daily Inngest cron (`cdr-sync`, concurrency 1) calls an idempotent `CdrSyncService.run()`
that, per linked account: pulls settled transactions from RedBark (`from = highWaterMark − 14d`,
90-day backfill on first run), maps them into the app's Spend-positive glossary with a
fail-loud sign check, upserts them through `TransactionsService.upsertSynced` keyed on
`(provenance, externalId)` touching **bank-owned columns only**, and only then advances the
account's cursor in `cdr_sync_state` (never backwards). When every account counted toward cash
(`inBalance`: transaction, savings and credit-card accounts by default, never loans) is syncable
and reports `fresh`, it anchors one household `balance_snapshot` row through
`BalancesService.recordSynced`; that row replaces a typed balance until the member types a newer
one. A dead
consent (`revoked|expired|invalidated`) stops that connection and shows on the dashboard; it is
not retried. An unset `REDBARK_API_KEY` makes the whole cron a no-op. A signed RedBark webhook
can trigger the same idempotent `run()` early. Every member edit (description, category, group,
expense link, notes) survives every re-sync.

## Out of Scope

- **PayPal sync** — the other half of roadmap stage 7; its own plan (the `paypal` provenance
  value is provisioned here but no PayPal code is written).
- **Transfer-filtering** — internal transfers double-count as paired Spend + Inflow (adr017
  Negative Consequences); deferred to its own design.
- **Cross-provenance consolidation** — the same purchase arriving as both `cdr` and `paypal`
  (or overlapping a manual `import`) is not merged.
- **Deleted synced rows** — a member-deleted `cdr` row comes back if it falls inside a later
  run's 14-day overlap. No tombstones.
- **In-app per-user consent / redirect flow** — banks are linked manually in RedBark's
  dashboard (adr017 credential posture).
- **Multi-currency** — non-AUD rows fail loud; single-currency asserted.
- **Per-account balance history / a `cdr_connection` table** — `connectionStatus` stays
  denormalised on `cdr_sync_state`; promote later only if the app launches publicly.
- **Adopting RedBark's hierarchical categories** — synced rows land uncategorised.
- **Household scoping** — new tables follow the current unscoped pattern.
- **A settings-page status surface** — the connection banner is dashboard-only.
- **An in-app `inBalance` toggle** — a member changes it with `make cdr_in_balance` (Phase 5).
- **Unlinked money in the balance line** — a synced anchor replaces a typed balance (adr017
  facet 6); no "unlinked funds" setting is added to the sum.

## Approach

Build the seven adr017 facets bottom-up so each phase ships alone and the risky,
external-facing work is verified before anything depends on it: schema foundation → adapter +
the sign-mapping sandbox spike (resolves adr017 Open Question #1) → sync state + the
transactions upsert → cron service + controller → balance anchor → connection-status surfacing +
seeding → webhook trigger.

The new `cdr` domain is a class-based 3-tier (adr004) with adr021 file names
(`cdr.inngest.controller.ts`, `cdr.trpc.controller.ts`, `cdr.http.controller.ts`). Under adr022,
`cdr.repository.ts` touches only `cdr_sync_state`. The scoped upsert lives in the transactions
domain (`TransactionsService.upsertSynced`), and the anchor insert lives in the balances domain
(`BalancesService.recordSynced`). Each is reached through a `Pick` port.

**No cross-domain `db.transaction()`.** Per account, the service upserts first and then advances
the cursor. If the upsert throws, the cursor stays put. If the process dies between the two
steps, the next run re-fetches the same window and the idempotent upsert absorbs it. adr017's
"never advance the cursor past un-ingested rows" still holds, by ordering alone. The cursor is
monotonic (`greatest`), so a short fetch never drags it back into the overlap or below a seeded
floor. Sync writes take no outbox event (the cron is the trigger; receipt matching is read-time).

**Two cdr services** (split rule: disjoint deps):
- `CdrSyncService` is the worker. It uses RedBark, transactions and balances.
- `CdrService` serves the tRPC read and webhook intake. It uses the repository and outbox.

So `services.ts` never needs the optional key. Non-trivial pure logic is built test-first per
the `tdd` skill: sign mapping, the scoped upsert, the freshness gate, the monotonic cursor and
the banner copy.

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
  | `connectionId` | text, null (a seeded row has none until the first run) |
  | `accountName` | text, null |
  | `highWaterMark` | timestamptz, null |
  | `connectionStatus` | enum, not null, default `pending` |
  | `lastSyncedAt` | timestamptz, null |
  | `lastError` | text, null |
  | `createdAt` | timestamptz, not null, **DB** default `.defaultNow()` (as `outbox.schema.ts:19`, not `$defaultFn`: the Phase 6 seed inserts with raw SQL) |
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
    the discovered list (a wrong seeded id, or a bank removed from RedBark) would stay `pending`
    and never sync, with nothing saying why. It counts as a failed account instead (see
    Failures): `recordError(accountId, "not in RedBark")` + `logger.error` naming the id. It is
    not retryable, so the run fails loud. Fix: delete that row in the Neon SQL editor, then
    re-seed with the right id. A row whose saved connection is listed but dead
    (`revoked | expired | invalidated`) isn't this case: Consent skips it, and the banner asks
    for a reconnect (deleting it would lose its mark).
  - **Consent** (adr017 credential posture):
    - `revoked | expired | invalidated` → skip that connection's accounts and `logger.warn`.
      Never retried.
    - `expiring` → `logger.warn`, then sync as normal.
    - `pending` → skip.
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
    - A null mark does the 90-day backfill; otherwise `from = hwm − 14d`.
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
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `registry-golden.test.ts` pins `cdr-sync` and its cron trigger (deliberate update)
- [ ] With the live key on the branch DB (RedBark has no sandbox; the run only reads RedBark),
      invoking `cdr-sync` from the Inngest dev server ingests settled rows, and a second invoke
      adds no new rows; with the key unset the run is a logged no-op
- [ ] When RedBark answers `429` with `Retry-After`, the Inngest dev server shows the next
      attempt scheduled after that wait (a wait over 1 h fails the run until the next cron),
      not on Inngest's default backoff

---

## Phase 5: Balance auto-anchor

Implements adr017 facet 6. Touches the dashboard balance card (UI honesty label).

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
  Null means "not decided yet": a seeded row has no type until its first discovery.
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
- `scripts/cdr-in-balance.ts` + `Makefile` `cdr_in_balance: install` → `node
  scripts/cdr-in-balance.ts $(account) $(value)` (arg style of `db_custom`, `Makefile:62`).
  Plain TS run by Node 24's type stripping, with the `postgres` driver,
  `process.loadEnvFile()` and no app imports; Phase 6's seed script copies this style. Against
  production, run it from `main` (whose `.env` is production). **A human runs it**: AGENTS.md
  bars agent writes on `main`. A script, not a data migration
  (`.claude/rules/database-migrations.md`): the account id and value aren't known when
  migrations run. It updates one row's `inBalance` and exits non-zero when no row has that
  `accountId` (run the sync or seed first).
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
  `inBalanceByDefault`: `coalesce` keeps a member's `cdr_in_balance` choice in the row, so a
  card set to false stays out.
  A closed counted account holds the anchor until set to false. A failed loan doesn't
  block it: a loan's rows breaking the sign check every day would otherwise hold the cash line
  for good. A retried run may write the anchor again; latest `asOf` wins, so the repeat is
  harmless. A null flag, or a counted account with a dead or pending consent or not
  `available`, skips the anchor with `logger.info`: dropping it would shrink the sum while
  every balance read still passes the freshness gate (a savings account under an odd type
  name). An account with `inBalance` false is ignored here, so a pending loan never blocks the
  cash line.
  1. Read `getAccountBalance` for each counted account.
  2. Call `anchorFromBalances`.
  3. Non-null → `balances.recordSynced(...)`; null → `logger.info` and skip.
  A throw anywhere in this step (a balance read, a non-AUD balance, `recordSynced`) skips the
  anchor with `logger.error` and never fails the run.
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
    - A throwing balance read, a non-AUD balance, or a throwing `recordSynced` each log an
      error, write no anchor, and `run()` resolves.
  - `balance-snapshot.display.test.ts` — the label for each source.

### Success
- [ ] `make check` passes (incl. `db:check` and the contract)
- [ ] `make test` passes
- [ ] `/design-review` (balance card gains the source label)
- [ ] A live card balance with money owing reads negative; noted in adr017 facet 6
- [ ] A sync writes exactly one `cdr` snapshot summing only `inBalance` accounts: a credit
      card's balance lowers it and a loan is left out. A stale counted account, one with a
      dead consent, or any account still undecided (null) leaves the balance line unchanged
- [ ] `make cdr_in_balance account=… value=false` drops that account from the next anchor, a
      later sync doesn't flip it back, and an unknown account id exits non-zero
- [ ] A typed `balance.set` shows until the next sync writes a newer `cdr` row (source is a
      label only)

---

## Phase 6: Connection-status surfacing + account seeding

Completes adr017 facet 5's operational readiness and the consent-lifecycle surfacing. **Must run
before the first live sync** (before `REDBARK_API_KEY` is set in production).

### Changes
- `src/server/cdr/cdr.service.ts` — `class CdrService` (deps `{ repository: CdrRepository }`)
  with `listSyncState()`. It is separate from `CdrSyncService`, so the tRPC root never builds
  RedBark, transactions or balances.
- `src/server/cdr/cdr.trpc.controller.ts` — `cdrRouter` with `syncState:
  protectedProcedure.query(({ ctx }) => ctx.services.cdr.listSyncState())` (template
  `balances.trpc.controller.ts:4-10`). Mount it as `cdr` in `src/server/api/root.ts:13-23`, and
  build `cdr: new CdrService({ repository: new DrizzleCdrRepository({ db }) })` in
  `services.ts:29-45`.
- **Seed the pre-imported account** (adr017 facet 5) with `scripts/cdr-seed.ts`:
  - Same style as Phase 5's `scripts/cdr-in-balance.ts`: plain TS run by Node 24's type
    stripping (`package.json` is `"type": "module"`), the `postgres` driver,
    `process.loadEnvFile()`, no app imports or `~/` aliases. Human-run only, like that one; a
    migration can't call RedBark or know `from`.
  - Args: `account` (the RedBark account id from its dashboard) and `from` (the first day CDR
    owns — the day after the last manual row), read as UTC midnight like the mapper's row dates
    (`src/domain/cdr/map-redbark.ts:38`). A `from` after today exits non-zero: the mark never
    moves back, so a typo'd future day would skip every row until then with nothing said.
  - It upserts that account's `cdr_sync_state` row with `highWaterMark = from + 14 days`, so the
    first fetch (`hwm − 14d`) starts exactly at `from`. The monotonic cursor (Phase 3) keeps every
    later fetch at or after it, so there is no cross-provenance duplicate period.
  - It refuses to lower an existing mark.
  - It leaves `inBalance` null; the first discovery fills it from the account's type.
  - **It checks the id with RedBark before writing.** It pages `GET {REDBARK_API_URL}/v2/accounts`
    with plain `fetch` and `REDBARK_API_KEY` from the environment. The URL defaults to
    `https://api.redbark.com` (as `src/env.ts:118`). It sends `Redbark-Version` (RedBark wants it
    on every request; copy `cdr.redbark.ts:15`, since the script imports no app code). Like the
    client, it refuses a next page on another origin, because every request carries the key.
    When the id isn't listed it exits non-zero and writes nothing; when it is, it prints the
    account's name. Phase 4's
    "not in RedBark" check comes too late: by then that same first run has found the real
    account with no saved mark and backfilled 90 days over the manual rows. The key isn't a
    Vercel secret yet at this step, so pass it inline: `REDBARK_API_KEY=… make cdr_seed …`.
- `Makefile` — `cdr_seed: install` runs `node scripts/cdr-seed.ts $(account) $(from)` (arg style of
  `db_custom`, `Makefile:62`). Production setup order: migrations → `make cdr_seed` against
  production (`main` `.env`) → set the key.
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
    mark. A fresh link makes new ids, which backfill 90 days (see the re-link runbook).
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
  (`transactions.repository.ts:222-243`: `amount > 0 AND expenseId IS NULL`). Verify; no new
  surface (adr017 Positive Consequences).
- Tests:
  - `cdr.service.test.ts` — `listSyncState` delegates.
  - `cdr.trpc.controller.test.ts` — `createTestCaller` with `Partial<CdrService>` (pattern
    `balances.trpc.controller.test.ts:9-58`). The procedure calls the service; a signed-out call
    gets `UNAUTHORIZED`.
  - `cdr-connection.display.test.ts` — each status → its notice; an `active` account with
    `lastError` → warn naming it and its last sync date, not the error text; mixed → alert wins;
    empty → null.
  - `cdr-connection-notice.test.tsx` (jsdom) — a warn notice renders `role="status"`, an alert
    notice renders `role="alert"` with the account names and the reauthorize copy (queried by role
    and text).
  - `cdr-sync.service.test.ts` — a seeded mark makes the fetch start at the seeded `from`, not
    the 90-day backfill.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `/design-review` (connection-status banner)
- [ ] After `make cdr_seed` on the branch DB, the first run fetches from the seeded `from` (no
      90-day backfill over already-imported rows)
- [ ] On the first live run after seeding, rows dated `from` match the bank statement for that
      day: none missing, none repeating a manual row. The client sends `from` as a bare date
      (`cdr.redbark.ts:87`); a timestamp would be UTC midnight, 10–11 am in Sydney, and drop that
      morning.
- [ ] A `revoked` connection shows the reauthorize banner and its accounts stop syncing; an
      `expiring` one shows a soft warning; no banner shows with no linked accounts
- [ ] A failing `cdr.syncState` read hides the banner; the header and every other section
      still render
- [ ] `make cdr_seed` with an account id RedBark doesn't list, or a `from` after today, exits
      non-zero and leaves `cdr_sync_state` unchanged; a listed id prints the account's name

---

## Phase 7: RedBark webhook trigger (final)

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
  webhook routes), so export one `cdrService` (`{ repository, outbox: outboxService }`).
  `services.ts` imports it. Add it to the module list in `.claude/rules/server-architecture.md`.
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
    timeout: "30m" }`, `retries: RETRIES`). Its handler calls the same `run()` with the same
    error mapping as `cdr-sync`; move that mapping into one private method both share.
  - Both functions take `concurrency: { limit: 1, key: '"cdr-sync"', scope: "env" }`, so a
    webhook run never overlaps the cron run.
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
    has the debounce, and it shares the concurrency key with `cdr-sync`. Its handler calls
    `run()` and maps a `CdrSyncError` like `cdr-sync` does.
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
- Production setup order:
  1. Migrations `0019`–`0021` deploy.
  2. `REDBARK_API_KEY=… make cdr_seed account=… from=…` against production. It refuses an id
     RedBark doesn't list.
  3. Set `REDBARK_API_KEY` (and the webhook secrets once Phase 7 ships) as Vercel dashboard
     secrets.
  4. After the first run, check the logs for an unknown-account-type `warn`. The anchor waits
     until each is set. Set each one with
     `make cdr_in_balance account=… value=true|false` from `main`.
- Re-link runbook. Reauthorize first: it keeps every id, so nothing else is needed. Only when
  RedBark refuses it (it answers `404` once an expired consent's data is deleted) link the bank
  afresh. Then, **before the next 18:00 UTC cron**:
  1. `make cdr_seed account=<new id> from=<day after the old account's newest synced row>`
     for each new account, so the first run doesn't backfill 90 days over rows already synced.
  2. Delete the old account's `cdr_sync_state` row in the Neon SQL editor. RedBark no longer
     lists it, so it would fail every run as "not in RedBark" (Phase 4).

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — build stage 7
  (carries `## Related ADRs`)
- ADR: `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` (Status: In Progress). It
  was revised in place on 2026-10-09; Phase 2 records the sign result. It is implemented across
  all phases. Facet → phase map:
  - facet 1 (provenance model) → Phase 1
  - facets 3, 4 (settled-only, sign mapping) → Phase 2 (spike resolves Open Question #1)
  - facets 2, 5 (dedup upsert, `cdr_sync_state`) → Phases 3, 4, 6
  - facet 7 (poll-first / webhook-later) → Phases 4, 7
  - facet 6 (balance auto-anchor, `inBalance` scope resolved 2026-10-19) → Phase 5
  - credential & consent posture → Phases 2, 4, 6
- Composed with (Accepted):
  - `adr002` — outbox + Inngest rails
  - `adr004` — 3-tier
  - `adr005` — per-domain schema files
  - `adr013` — Terraform→Vercel env
  - `adr021` — `<domain>.<transport>.controller.ts`, tRPC router is the controller
  - `adr022` — cross-domain data through the owning service
  - `adr023` — `cdr/` is its own top-level domain
  - `adr027` — `AsyncBoundary` is the only loading region (Phase 6 banner)
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
