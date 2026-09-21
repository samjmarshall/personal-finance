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

## Current State

- **No provenance columns.** `src/server/transactions/transactions.schema.ts:15-45` has no
  `provenance` / `externalId` / `accountName`; no unique dedup index. pgEnums live at
  `transactions.schema.ts:6-13` (built from `src/lib/constants.ts`); indexes at
  `transactions.schema.ts:39-44`. Manual inserts run through the plain tRPC router
  `src/server/api/routers/transaction.ts:191-203` (`ctx.db.insert(...).values(input)`), which
  is **not** 3-tier migrated. Read interface: `src/domain/transactions/transaction.interface.ts:10-11`.
- **Rails exist (stage 4).** Inngest client `src/server/inngest/client.ts:13-16`;
  `EVENT_REGISTRY` + `buildOutboxEvent` at `src/server/inngest/events.ts:9-36`; composition
  root `src/server/inngest/functions.ts:22-37`; served at `src/app/api/inngest/route.ts:10-12`
  (`maxDuration = 300`). Frozen ids/triggers pinned in
  `src/server/inngest/registry-golden.test.ts:12-52`. A cron function is declared like
  `outbox-sweep` at `src/server/outbox/outbox.controller.ts:25-32`.
- **Receipts is the 3-tier reference** ([adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md)):
  controller `src/server/receipts/receipts.controller.ts:8-56` (`RETRIES` const,
  `createFunction`, `attempt → isFinalAttempt`, `get functions()`); service
  `src/server/receipts/receipts.service.ts:132-194` (`interface …Deps`, `new X({…})`,
  retryable-rethrow vs `markFailed`); repository
  `src/server/receipts/receipts.repository.ts:24-119` (`interface` + `class Drizzle…`,
  intent-named methods, `db.transaction()`); adapter one-file pattern at
  `src/server/blob-store/blob-store.ts:15-59`.
- **Balance is manual, insert-only.** `balance_snapshot` at
  `src/server/balances/balances.schema.ts:6-14` (`amount`, `asOf`, no `source`).
  `balance.set` inserts a new row (`src/server/api/routers/balance.ts:21-29`); `balance.latest`
  reads newest (`balance.ts:9-18`). Cashflow uses the latest snapshot as the projection pivot
  (`src/server/api/routers/cashflow.ts:52-56`, `:73-75`); pivot maths in
  `src/domain/cashflow/cashflow.ts:271-304`, `:452-458`.
- **No `cdr` domain, no `REDBARK_*` env, no webhook route** exist today.

## Desired End State

A daily Inngest cron (`cdr-sync`, concurrency 1) calls an idempotent `CdrSyncService.run()`
that, per linked account: pulls settled transactions from RedBark (`from = highWaterMark − 4d`,
90-day backfill on first run), maps them into the app's Spend-positive glossary with a
fail-loud sign check, upserts them into `transaction` keyed on `(provenance, externalId)`
touching **bank-owned columns only**, advances a per-account cursor in `cdr_sync_state` (all in
one `db.transaction()`), and — when every account reports `fresh` — anchors one household
`balance_snapshot` row. A dead consent (`revoked|expired|invalidated`) stops that connection
and is surfaced, not retried. An unset `REDBARK_API_KEY` makes the whole cron a no-op. A signed
RedBark webhook can trigger the same idempotent `run()` early. Every member edit (rename,
category, expense link) survives every re-sync.

## Out of Scope

- **PayPal sync** — the other half of roadmap stage 7; its own plan (the `paypal` provenance
  value is provisioned here but no PayPal code is written).
- **Transfer-filtering** — internal transfers double-count as paired Spend + Inflow (adr017
  Negative Consequences); deferred to its own design.
- **Cross-provenance consolidation** — the same purchase arriving as both `cdr` and `paypal`
  (or overlapping a manual `import`) is not merged.
- **In-app per-user consent / redirect flow** — banks are linked manually in RedBark's
  dashboard (adr017 credential posture).
- **Multi-currency** — non-AUD rows fail loud; single-currency asserted.
- **Per-account balance history / a `cdr_connection` table** — `connectionStatus` stays
  denormalised on `cdr_sync_state`; promote later only if the app launches publicly.
- **Adopting RedBark's hierarchical categories** — synced rows land uncategorised.
- **Household scoping** — new tables follow the current unscoped pattern.

## Approach

Build the seven adr017 facets bottom-up so each phase ships alone and the risky, external-facing
work is verified before anything depends on it: schema foundation → adapter + the sign-mapping
sandbox spike (resolves adr017 Open Question #1) → sync-state repository → cron service +
controller → balance anchor → connection-status surfacing + seeding → webhook trigger. The new
`cdr` domain mirrors `receipts/` exactly (class-based 3-tier, adr004). Sync writes take **no
outbox event** (the cron is the trigger; receipt matching is read-time) — the cdr repository
writes directly inside one `db.transaction()` per account. Non-trivial pure logic (sign mapping,
the scoped upsert, the freshness gate) is built test-first per the `tdd` skill.

---

## Phase 1: Provenance schema foundation

Implements adr017 facet 1 (provenance model). Backend only, no UI.

### Changes
- `src/lib/constants.ts` — add a `Provenance` enum (`manual | import | cdr | paypal`),
  mirroring the `Priority` / `Frequency` shape used at `src/lib/constants.ts:1-121` and fed into
  the schema pgEnums at `transactions.schema.ts:6-13`.
- `src/server/transactions/transactions.schema.ts` — add pgEnum `transaction_provenance`; add
  columns `provenance` (notNull, default `manual`), `externalId` (text null), `accountName`
  (text null); add a **partial** unique index `(provenance, externalId) WHERE external_id IS NOT
  NULL` (adr017 facet 1 — unlimited NULL-`externalId` manual rows coexist with one row per
  `(cdr, txn.id)`). Extend the existing index block at `transactions.schema.ts:39-44`.
- `src/domain/transactions/transaction.interface.ts` — add `provenance`, `externalId`,
  `accountName` to the read type (`:10-11` is where the FK fields already sit); barrel unchanged.
- `src/server/api/routers/transaction.ts` — no code change: `create` (`:191-203`) keeps
  inserting the DTO; DB default stamps `provenance = 'manual'`. (Confirm the leftJoin `list`
  read at `:55-126` still type-checks with the new columns.)
- `drizzle/0011_*.sql` — generated via `make db_generate`, applied via `make db_migrate`
  (analyzer confirms next file is `0011`).
- `src/server/transactions/transactions.schema.test.ts` — extend the column-contract test to
  assert the three new columns and that `provenance` defaults to `manual`.

### Success
- [ ] `make check` passes (incl. `db:check` — generated migration matches schema)
- [ ] `make test` passes
- [ ] `/security-review` (touches `src/lib/**`)
- [ ] Migration applies cleanly on a copy of the DB; a manual transaction insert with no
      `provenance` reads back `provenance = 'manual'`, `externalId = null`
- [ ] Two manual rows with NULL `externalId` insert fine; two rows with the same
      `(cdr, 'txn_x')` violate the partial unique index

---

## Phase 2: RedBark adapter + sign-mapping sandbox spike

Implements adr017 facets 3 (settled-only) and 4 (sign + amount mapping). Resolves adr017 Open
Question #1. **Prerequisite:** a RedBark `livemode:false` sandbox API key.

### Changes
- `src/env.js` — add `REDBARK_API_KEY`: server-only, **optional** (not `requiredInProd`) so an
  unset key no-ops the cron (adr017 credential posture); mirror the `RESEND_API_KEY` entry.
- `.env.example` — add `REDBARK_API_KEY=` with a comment.
- `src/server/cdr/cdr.redbark.ts` — `interface RedbarkClient` + `class HttpRedbarkClient`
  (interface + impl in one file, per `src/server/blob-store/blob-store.ts:15-59`). Methods:
  `listConnections()`, `listAccounts()`, `listTransactions({ accountId, from })` following
  `next_page_url` to null and sending `include_pending=false` (adr017 facet 3),
  `getAccountBalance(accountId)`. Bearer key + a `REDBARK_VERSION` **code constant**
  (`"2026-10-01.wattle"`, adr017 credential posture) as the `Redbark-Version` header. On `429`
  / `5xx` throw a tagged retryable error honoring `Retry-After`.
- `src/domain/cdr/` — Zod DTOs for the RedBark `Transaction` (`Money` object = integer minor
  units + `currency` + optional `direction`/`status`), `Account`, `Balance` (`current`,
  `available`, `freshness`, `observed_at`), and a `connectionStatus` union
  (`pending|active|expiring|expired|invalidated|revoked`); barrel `index.ts`.
- `src/domain/cdr/cdr.map.ts` — pure `mapRedbarkTransaction(row)`: prefer `direction`
  (`debit`→Spend **positive**, `credit`→Inflow **negative**), cross-check the numeric sign, and
  **throw on disagreement**; numeric-negation is the fallback only when `direction` is absent;
  `Money.amount ÷ 100`; assert `currency === "aud"` else throw (adr017 facet 4; signs per
  `CONTEXT.md` — positive = Spend).
- **Sandbox spike:** call the sandbox with the key, capture one real settled transaction row,
  and pin `mapRedbarkTransaction` against it. Record the confirmed sign convention in adr017
  (flip the facet-4 note from "pending spike" to confirmed; update Status/Open Questions).
- `src/domain/cdr/cdr.map.test.ts` — table-driven (`tdd` skill): debit→+, credit→−,
  direction/numeric disagreement→throw, missing direction→negate fallback, non-AUD→throw,
  minor-units ÷100, and the pinned real-sandbox fixture.
- `src/server/cdr/cdr.redbark.test.ts` — fake `fetch`: asserts auth + `Redbark-Version`
  headers, `include_pending=false`, `next_page_url` pagination follow, and `Retry-After`
  surfaced as a retryable error.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `/security-review` (touches `src/env.js`, `.env.example`)
- [ ] The sandbox spike is done and `mapRedbarkTransaction` is pinned against a real sandbox
      row; adr017 facet 4 no longer says "unverified"
- [ ] A `credit` row maps to a negative amount and a `debit` row to a positive amount; a row
      whose `direction` and numeric sign disagree throws; a non-AUD row throws

---

## Phase 3: `cdr_sync_state` schema + repository

Implements adr017 facets 2 (dedup upsert) and 5 (store-of-record via `cdr_sync_state`).

### Changes
- `src/server/cdr/cdr.schema.ts` — pgEnum `cdr_connection_status`
  (`pending|active|expiring|expired|invalidated|revoked`); table `cdr_sync_state`, one row per
  account (adr017 facet 5): `accountId` (text, unique), `connectionId` (text), `accountName`
  (text), `highWaterMark` (timestamptz null), `connectionStatus` (enum), `lastSyncedAt`
  (timestamptz null), `lastError` (text null), `createdAt`. (drizzle-kit globs
  `src/server/**/*.schema.ts`.)
- `src/server/cdr/cdr.repository.ts` — `interface CdrRepository` + `class DrizzleCdrRepository`
  (per `receipts.repository.ts:24-119`). Methods: `findSyncState(accountId)`,
  `upsertSyncState(row)`, `upsertTransactions(rows)` —
  `ON CONFLICT (provenance, externalId) DO UPDATE` set **bank-owned only** (`amount`, `date`,
  `accountName`), never member-owned (`expenseId`, `expenseCategoryId`, `category`, `priority`,
  `frequency`, `notes`), and `description` **INSERT-only** (adr017 facet 2) —
  `advanceHighWaterMark(accountId, mark)`, `setConnectionStatus(accountId, status)`,
  `recordError(accountId, message)`. Cross-domain write to `transaction` is direct (adr005 — no
  ceremony). Drizzle only, throws, no logging.
- `src/server/cdr/cdr.repository.test.ts` — hand-rolled chain-capturing fake `db` (per
  `receipts.repository.test.ts`): render the conflict target + WHERE with
  `new PgDialect().sqlToQuery(...).sql`; assert the `DO UPDATE` `set()` payload contains only
  `amount`/`date`/`accountName` and **excludes** `description` and every member-owned column;
  assert `upsertTransactions` + `advanceHighWaterMark` run inside one `transaction()`. Never
  hits Postgres.
- `drizzle/0012_*.sql` — `make db_generate` + `make db_migrate`.

### Success
- [ ] `make check` passes (incl. `db:check`)
- [ ] `make test` passes
- [ ] The upsert's `DO UPDATE` set touches only bank-owned columns (asserted in the repo test);
      re-upserting an existing `(cdr, txn.id)` leaves `expenseId`/`category`/`description`
      untouched

---

## Phase 4: `cdr` sync service + cron controller (poll)

Implements adr017 facet 7 (poll-first) and the construction rules. **Depends on Phase 2's
pinned mapping.**

### Changes
- `src/server/cdr/cdr.service.ts` — `class CdrSyncService` with
  `interface CdrSyncServiceDeps { repository: CdrRepository; redbark: RedbarkClient }` (deps
  typed as interfaces, per `receipts.service.ts:132-153`). `run()` is idempotent: discover
  accounts/connections; per account compute `from = highWaterMark − 4d` (or a 90-day backfill
  when `highWaterMark` is null, adr017 facet 5); fetch settled txns following pagination; map
  via `mapRedbarkTransaction`; `upsertTransactions` + `advanceHighWaterMark` in **one
  `db.transaction()`** so a mid-account failure never advances the cursor past un-ingested rows
  (adr017 construction). Consent lifecycle (adr017 credential posture): terminal
  `revoked|expired|invalidated` → `setConnectionStatus`, skip that connection's accounts, do not
  retry; `expiring` → soft warning; transient (network/`5xx`/`429`) → rethrow while attempts
  remain, else `recordError`. No outbox event. When `REDBARK_API_KEY` is unset, `run()` is a
  no-op.
- `src/server/cdr/cdr.controller.ts` — `class CdrController` declaring the Inngest scheduled
  function `cdr-sync` (`id: "cdr-sync"`, daily `cron`, `concurrency: { limit: 1 }`,
  `retries: RETRIES`), handler closes over `this.service` lazily and maps `attempt`→
  `isFinalAttempt` (per `receipts.controller.ts:8-50`); `get functions()` returns
  `[this.sync]`.
- `src/server/inngest/functions.ts` — compose `new CdrController({ inngest, service: new
  CdrSyncService({ repository: new DrizzleCdrRepository({ db }), redbark: new HttpRedbarkClient({
  apiKey: env.REDBARK_API_KEY }) }) })` and spread `...cdrController.functions` into the exported
  array (`functions.ts:34-37`). Real `db`/`env`/SDK touched only here.
- `src/server/inngest/registry-golden.test.ts` — **deliberate** golden update (adr017 pins
  `cdr-sync`): add `cdr-sync` + its cron trigger to the ids/triggers assertion (`:25-52`).
  EVENT_REGISTRY keys are **unchanged** this phase (cron trigger, no event).
- `src/server/cdr/cdr.service.test.ts` — fake `repository` + `redbark` object literals typed
  against the interfaces, recording calls (per `receipts.service.test.ts`): assert 90-day
  backfill on null `highWaterMark`; `from = hwm − 4d` otherwise; pagination consumed; mapping
  applied; upsert + advance called; terminal consent death stops the account and surfaces
  status without retry; transient error rethrows while attempts remain; no-op when key absent.
  Spy `console.error` on logged paths.
- `src/server/cdr/cdr.controller.test.ts` — spy `createFunction` captures `{ opts, handler }`
  (per `receipts.controller.test.ts`): assert frozen `id`/`concurrency`/trigger and that the
  handler routes to `service.run` with the right `isFinalAttempt` mapping at `attempt` 0 vs
  final.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `registry-golden.test.ts` pins `cdr-sync` and its cron trigger; the registry-golden suite
      passes with the deliberate update
- [ ] With a sandbox key set, one manual `run()` ingests settled rows idempotently (a second
      `run()` over the same window inserts nothing new); with the key unset, `run()` is a no-op

---

## Phase 5: Balance auto-anchor

Implements adr017 facet 6. Touches the dashboard balance panel (UI honesty label).

### Changes
- `src/server/balances/balances.schema.ts` — add a `source` pgEnum column (`manual | cdr`,
  default `manual`) to `balance_snapshot` (`:6-14`); **label only** — precedence stays pure
  latest-`asOf`, tiebreak `id desc` (adr017 facet 6). `drizzle/0013_*.sql` via `make db_generate`
  + `make db_migrate`.
- `src/server/api/routers/balance.ts` — `set` (`:21-29`) stamps `source: 'manual'`; `latest`
  (`:9-18`) returns `source` so the UI can distinguish "synced" from "you entered this".
- `src/server/cdr/cdr.repository.ts` — add `insertBalanceSnapshot({ amount, asOf, source })`
  (direct cross-domain write to `balance_snapshot`).
- `src/server/cdr/cdr.service.ts` — after the per-account sync, sum each **active** account's
  `current` balance (settled ledger, not `available`) into one household-wide snapshot, gated on
  **all** accounts reporting `freshness: fresh` (else skip the anchor rather than poison the
  line); `asOf` = the oldest `observed_at` summed; `source: 'cdr'` (adr017 facet 6).
- `src/domain/balances/balance.interface.ts` + the dashboard balance panel — surface a small
  "synced"/"manual" indicator from `source`. (Cashflow pivot maths at
  `src/domain/cashflow/cashflow.ts:271-304` is unchanged — precedence untouched.)
- `src/server/balances/balances.schema.test.ts` — assert `source` defaults to `manual`.
- `src/server/cdr/cdr.service.test.ts` — extend: all-fresh → one snapshot inserted with
  `source: 'cdr'` and `asOf` = oldest `observed_at`; any account stale → no snapshot; only
  `active` accounts summed.

### Success
- [ ] `make check` passes (incl. `db:check`)
- [ ] `make test` passes
- [ ] `/design-review` (dashboard balance panel gains the source label)
- [ ] A sync with all accounts `fresh` writes exactly one `cdr` snapshot; a stale account
      leaves the balance line unchanged
- [ ] A manual `balance.set` still wins when it is the latest `asOf` (source is label-only)

---

## Phase 6: Connection-status surfacing + account seeding

Completes adr017 facet 5's operational readiness and the consent-lifecycle surfacing. **Must run
before the first live sync** (before `REDBARK_API_KEY` is set in production).

### Changes
- `src/server/cdr/cdr.repository.ts` — `listSyncState()` read for the UI; a
  `seedHighWaterMark(accountId, mark)` path.
- **Seed the pre-imported account** (adr017 facet 5): a documented setup step (a one-shot
  admin tRPC mutation or a git-tracked seed migration) that sets the `highWaterMark` of the
  account manually imported since January to where its manual data ends, so CDR starts *after*
  the manual rows — no cross-provenance duplicate period.
- Member-facing status surface: a dashboard/settings banner driven by `connectionStatus` —
  `expiring` = soft warning, `expired|revoked|invalidated` = a call to re-link the bank in
  RedBark's dashboard. Reuse existing UI primitives.
- Synced Spend with no `expenseId` already lands in the existing **Unplanned** queue
  (`src/server/api/routers/transaction.ts:235-258`) — verify, no new surface needed (adr017
  Positive Consequences).
- Tests: read-query test for `listSyncState`; a UI/component test asserting the banner renders
  per status; a test that seeding sets `highWaterMark` and the next `run()` fetches from the
  seeded mark, not the 90-day backfill.

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `/design-review` (connection-status banner)
- [ ] After seeding the pre-imported account, a first `run()` fetches from the seeded mark (no
      90-day backfill over already-imported rows)
- [ ] A `revoked` connection shows the re-link call-to-action and its accounts stop syncing

---

## Phase 7: RedBark webhook trigger (final)

Implements adr017 facet 7's additive webhook trigger. **Prerequisite (adr017 Open Question):
confirm RedBark's `transactions.synced` / `connection.*` payload shapes, event-type names, and
signature schemes from RedBark docs/support before coding** — they are unpublished today.

### Changes
- `src/server/inngest/events.ts` — add event names `cdr/sync.requested` and
  `cdr/connection.changed` to `EVENT_REGISTRY` with Zod payloads, minted through
  `buildOutboxEvent` (`events.ts:9-36`). Additive (new keys, no renames).
- `src/server/cdr/cdr.controller.ts` — add an event trigger `{ event: "cdr/sync.requested" }` to
  the existing `cdr-sync` function (so a webhook enqueues the same idempotent `run()`), and an
  event-triggered handler for `cdr/connection.changed` that flips `connectionStatus`.
- `src/app/api/cdr/webhook/route.ts` — its own composition root (per the email webhook
  `src/app/api/receipts/inbound/route.ts` and `src/server/email/email.*`): reads env (500 when
  the signing secret is unset), builds tiers lazily in a `compose()` memo, `POST` returns
  `controller.handle(request)`.
- `src/server/cdr/cdr.webhook.controller.ts` — HTTP controller using plain `Request`/`Response`.
  **Two verifiers that must not be conflated** (adr017 facet 7): the **webhook destination**
  (`transactions.synced`) verifies `X-Redbark-Signature: sha256=<hex>` over `<timestamp>.<body>`
  and dedups on `X-Redbark-Delivery-Id` → emits `cdr/sync.requested`; the **event destination**
  (`connection.*`) verifies the Stripe-style `Redbark-Signature: t=,v1=` → emits
  `cdr/connection.changed`. Handlers close over `this.service` lazily.
- `src/env.js` + `.env.example` — add the webhook signing secret(s) (`REDBARK_WEBHOOK_SECRET`
  and, if distinct, the event-destination secret); server-only, optional.
- `src/server/inngest/registry-golden.test.ts` — **deliberate** golden update: add the two event
  keys to the keys assertion and the added event trigger on `cdr-sync` to the triggers assertion
  (`:12-52`).
- Tests: `cdr.webhook.controller.test.ts` — fake verifier + fake service (call `handle(new
  Request(…))`): valid signature → 200 + correct event emitted; bad signature → 401; replayed
  `X-Redbark-Delivery-Id` → 200 no-op; the two verifiers are exercised independently.
  `route.test.ts` — mock the tier modules; assert only the root's job (env gate, built once,
  delegates to `handle`).

### Success
- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `/security-review` (signature verification, `src/env.js`, `.env.example`, public endpoint)
- [ ] RedBark payload/signature schemes are confirmed and cited in the controller
- [ ] A validly-signed `transactions.synced` delivery triggers a `run()`; a bad signature is
      rejected 401; a replayed delivery id is a 200 no-op; a `connection.*` event flips
      `connectionStatus`

---

## Validate (whole branch)

- `/validate` runs `/code-review` over the full branch (standing step, not per-phase).
- Production enablement gate: do **not** set the production `REDBARK_API_KEY` until RedBark v2
  GA is confirmed (adr017 Open Question — beta `2026-10-01.wattle`). The optional key means the
  cron stays a safe no-op until then.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — build stage 7
  (carries `## Related ADRs`)
- ADR: `docs/adr/adr017-external-transaction-sync-via-cdr-redbark.md` (Status: In Progress) —
  implemented across all phases; facet → phase map:
  - facet 1 (provenance model) → Phase 1
  - facets 3, 4 (settled-only, sign mapping) → Phase 2 (spike resolves Open Question #1)
  - facets 2, 5 (dedup upsert, `cdr_sync_state`) → Phases 3, 4, 6
  - facet 7 (poll-first / webhook-later) → Phases 4, 7
  - facet 6 (balance auto-anchor) → Phase 5
  - credential & consent posture → Phases 2, 4, 6
- Composed with (Accepted): `adr002` (outbox + Inngest rails), `adr004` (3-tier, `receipts/`
  reference), `adr005` (per-domain schema files), `adr013` (Terraform→Vercel env). Contrasts:
  `adr006`/`adr007` (inbound session creds), `adr014` (Bedrock OIDC creds).
- Terminology: `CONTEXT.md` — **Provenance** (column `provenance`, avoid "source"),
  **Spend**/**Inflow** sign convention (positive `amount` = Spend), **Unplanned**, **Transaction**.
- Prior stage plans: `thoughts/plans/2026-09-01-expense-linking-stage-4.md` (rails),
  `thoughts/plans/2026-09-04-expense-linking-stage-5.md` (receipts reference).
- Key existing code: `src/server/transactions/transactions.schema.ts:15-45`,
  `src/server/receipts/receipts.{controller,service,repository}.ts`,
  `src/server/outbox/outbox.controller.ts:25-32`, `src/server/inngest/{events,functions}.ts`,
  `src/server/inngest/registry-golden.test.ts:12-52`, `src/server/balances/balances.schema.ts:6-14`,
  `src/server/api/routers/{balance,cashflow,transaction}.ts`,
  `src/app/api/receipts/inbound/route.ts`, `src/server/blob-store/blob-store.ts:15-59`.
