---
Status: 'In Progress'
Deciders: 'Sam Marshall'
Date: '2026-10-20'
# prettier-ignore
---

# Sync bank transactions via the RedBark CDR aggregator with the app as store-of-record, provenance-keyed dedup, and a poll-first worker

Technical Story: [Expense Linking, Receipts, Cash Flow — Roadmap Design, stage 7](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)

> **Revised in place 2026-10-09** (no code had shipped). Three things changed. First, [adr022](adr022-cross-domain-data-through-the-owning-service.md) gives each domain sole ownership of its tables, so the earlier "one `db.transaction()` per account" is gone. Instead, the upsert runs through `TransactionsService` and then the cursor advances: the order of the two writes keeps the invariant. Second, the controller files take the [adr021](adr021-trpc-router-is-the-controller-tier.md) `<domain>.<transport>.controller.ts` names. Third, the key is a Vercel dashboard secret, not a Terraform-written var. The facet decisions are otherwise unchanged.

## Context and Problem Statement

The household ledger is entered by hand or imported from statement CSVs. Stage 7 of the roadmap replaces that toil with a daily bank sync through [RedBark](https://redbark.com/docs/api-reference/v2/overview), a CDR (Consumer Data Right / open banking) aggregator. Banks are linked once in RedBark's dashboard; a single account-level API key then reads every linked account's settled transactions and balances.

Everything else in the app reads the local `transaction` table: expense links (`expenseId`, [adr010](adr010-single-nullable-fk-transaction-expense-link.md)), categorisation, receipt matching, and the cash-flow projection. A synced transaction has to become an ordinary ledger row, not a live view onto a third party. It also has to survive re-ingestion: sync windows overlap to catch late-posting rows, and RedBark's webhooks (a later trigger) deliver at-least-once, so the same transaction arrives repeatedly. And a member may rename, categorise, or link a synced row — those edits must not be clobbered by the next sync.

Two constraints are specific to this integration. First, RedBark v2 is **in beta**, and the facts that matter most are underspecified: the REST transaction `amount` is a `Money` object in integer minor units whose **sign convention is undocumented** (only the legacy pre-v2 webhook payload states "negative for debits"), and `status`/`direction` are bare strings with no enum on the REST surface (a live spike has since confirmed the sign; see facet 4). Second, a bank consent can lapse — RedBark exposes a connection `status` of `pending|active|expiring|expired|invalidated|revoked` — and a dead connection is a business state to surface, not a transient error to retry.

How should the app ingest external CDR transactions so that the local ledger stays authoritative, re-ingestion is idempotent, member edits are preserved, and a beta API's surprises fail loud rather than mis-post?

## Decision Drivers

- **App stays store-of-record.** Synced rows must be ordinary `transaction` rows so expense links, categorisation, receipts, and the projection keep working unchanged.
- **Idempotent / at-least-once.** Overlapping poll windows and at-least-once webhooks re-deliver the same transaction; re-ingest must neither duplicate nor mutate what a member touched.
- **Member edits are sacred.** A renamed, categorised, or expense-linked synced row survives every re-sync.
- **Complexity must be earned** (pre-PMF, one developer — echoes [adr006](adr006-redis-session-cache-with-postgres-durable-copy.md)). No per-account balance history, no connection table, no transfer or cross-provenance consolidation engine until a need is real.
- **Beta API, undocumented specifics.** The REST amount sign and `status`/`direction` enums are undocumented; the design fails loud on disagreement rather than silently posting a refund as a purchase.
- **Consent lifecycle is first-class.** A `revoked|expired|invalidated` connection stops sync and surfaces; it is not retried.

## Considered Options

1. **App store-of-record; poll-first; provenance-keyed dedup.** Postgres owns the ledger. A daily cron pulls settled transactions per account, upserts them keyed on `(provenance, externalId)`, tracks a per-account cursor in a new `cdr_sync_state` table, and auto-anchors the balance line. Webhooks are a later, additive trigger of the same idempotent service.
2. **RedBark as store-of-record / on-demand mirror.** Don't persist synced rows; query RedBark live at read time.
3. **Webhook-push-only.** Receive rows solely from `transactions.synced` webhooks; no polling backstop.
4. **Manual CSV import only (status quo).** Keep hand-importing statements.

## Decision Outcome

Chosen option: **"1. App store-of-record; poll-first; provenance-keyed dedup"**, because it is the only option that keeps the local ledger authoritative while paying for dedup exactly once (three columns) and degrading safely on a beta API — see the flow under option 1. Status is **In Progress**: the architecture is settled and agreed, but one item blocks full acceptance (see Open Questions): RedBark's beta status. The sign-convention spike is done (facet 4).

The facet decisions that make up this option:

1. **Provenance model.** A Postgres `pgEnum` `transaction_provenance` (`manual | import | cdr | paypal`) plus `externalId` (text) and `accountName` (text) on `transaction` — matching the `pgEnum` pattern of `transaction_frequency`/`transaction_priority`, not a bare `text` column. Uniqueness is a **partial** index `(provenance, externalId) WHERE externalId IS NOT NULL`, so unlimited manual rows (NULL `externalId`) coexist with one row per `(cdr, txn.id)`.
2. **Dedup key = `(cdr, redbark txn.id)`.** The unique index is the dedup. Re-ingest is `ON CONFLICT (provenance, externalId) DO UPDATE` scoped to **bank-owned columns only** — `amount`, `date`, `accountName` — and never touches member-owned columns (`expenseId`, `categoryId`, `group`, `priority`, `frequency`, `notes`). `description` is **INSERT-only**: bank raw text lands once, the member owns it after.
3. **Settled only.** Sync sends `include_pending=false` (the API default). A Transaction is "money that actually moved" (glossary); pending amounts are volatile and match receipts badly. With settled-only, the `ON CONFLICT` update is normally a no-op.
4. **Sign + amount mapping (defensive, confirmed 2026-10-16).** App glossary is Spend-positive / Inflow-negative — the opposite of CDR's account-holder view. The mapping prefers the `direction` field when present (`debit`→Spend positive, `credit`→Inflow negative), cross-checks it against the numeric sign, and **fails loud on disagreement**; numeric-negation is the fallback only when `direction` is absent. `Money.amount` (integer minor units) is converted to dollars (÷100) and `currency` is asserted `== "aud"` — single-currency; multi-currency is out of scope. **Confirmed by a live spike** (RedBark has no sandbox; `livemode` is always `true`): about 1,000 settled rows over 90 days from Fiskil-backed accounts. Every `debit` was ≤ 0 and every `credit` > 0, with no disagreement. So `amount` carries CDR's account-holder sign, and negating it gives the app's glossary. Every row was `posted` and lowercase `aud`. Zero-amount debits occur and map to `0`. The mapping is pinned in `src/domain/cdr/map-redbark.test.ts`.
5. **App is store-of-record via `cdr_sync_state`.** New `cdr` domain, one row per account (forced by the API — `GET /transactions` takes exactly one `account`): `accountId` (unique), `connectionId`, `accountName`, `highWaterMark` (newest ingested txn `date`, capped at now; RedBark gives a calendar day, not a time), `connectionStatus` (denormalized mirror of RedBark connection status, default `pending`), `lastSyncedAt`, `lastError`, `inBalance` (whether the account counts toward the balance anchor, facet 6). For Settings → Bank accounts it also holds `institutionName` and `accountNumber` (RedBark's masked last four), refreshed by discovery; `balance` and `balanceAsOf`, the latest readable `current` from one bulk `GET /balances` per run (an unreadable account keeps its last); and `nickname`, the member's own name for the account, which discovery never writes, so a sync can't undo a rename. `connectionId`, `accountName` and these five are nullable: a seeded row has none until its first run. Each run fetches `from = highWaterMark − 14d` (overlap re-catches late-settling rows: `from` filters on `date`, which isn't the posting date since RedBark has a separate `post_date`, and a card row can settle 5+ days after its `date` over a long weekend; the unique index makes it idempotent), follows `next_page_url` to null, upserts, then advances the mark. The mark is **monotonic** (`greatest(old, new)`), so a short fetch never drags it backwards. First sync (`highWaterMark` null) backfills **90 days**. The one account already manually imported since January is handled by **seeding its `highWaterMark`** at setup (`make cdr_seed`). The seeded mark is `from + 14d`, where `from` is the first day CDR owns, so the first fetch starts exactly at `from`. The monotonic mark keeps every later fetch at or after it: CDR starts after the manual rows, with no cross-provenance duplicate period.
6. **Balance auto-anchor.** Sync sums the `current` balance (settled ledger, not `available`) of each **counted** account into one household-wide `balance_snapshot` row (the table stays single-number). An account counts when its `inBalance` flag is true. Discovery fills the flag once from RedBark's free-text account `type`: `transaction`, `savings` and `credit-card` count, `loan` doesn't, and an unknown type stays null (logged each run) until a member sets it (Settings → Bank accounts). Sync never overwrites a set flag. A credit card counts because it is paid in full each month, so its negative balance is money already spent; a car or home loan is debt, not cash. **Card sign confirmed 2026-10-20** by a live read: both credit cards with money owing, and the loan, report a negative `current`, so summing `current` lowers the line by card debt. The anchor is gated on no counted account failing and **every counted** account being syncable and reporting `freshness: fresh`, and on no account's flag still being null. Otherwise the run skips the anchor rather than poison the line: an undecided account might be savings under an odd type name, so leaving it out would shrink the sum. An account with `inBalance` false never blocks it. `asOf` = the oldest `observed_at` summed. A `source` column (`manual | cdr`, default `manual`) is **added as a label only** (UI honesty: "synced" vs "you entered this"); precedence stays pure latest-`asOf` (tiebreak `id desc`), so a sync replaces a typed balance and a newer typed one shows until the next sync. The sum covers **linked accounts only**; unlinked money is not counted, and there is no override for it.
7. **Poll-first; webhook later.** A daily Inngest scheduled function `cdr-sync` (concurrency 1) calls the idempotent `CdrSyncService.run()`. Because `run()` is idempotent, webhooks are a free additive trigger later: RedBark's **webhook destination** (`transactions.synced`, verify `X-Redbark-Signature: sha256=<hex>` over `<timestamp>.<body>`, dedup `X-Redbark-Delivery-Id` by deriving the outbox event id from it, so a replay hits the outbox primary key) enqueues the same `run()`; its **event destination** (`connection.*`, verify the Stripe-style `Redbark-Signature: t=,v1=`) flips `connectionStatus`. The two verifiers must not be conflated.

Construction follows the 3-tier pattern ([adr004](adr004-domain-oriented-3-tier-server-architecture.md)) with `receipts/` as the reference. Files:

- Controllers, with [adr021](adr021-trpc-router-is-the-controller-tier.md) names: `cdr.inngest.controller.ts`, `cdr.trpc.controller.ts` and `cdr.http.controller.ts`.
- Services: `cdr-sync.service.ts` (`CdrSyncService`, the worker) and `cdr.service.ts` (`CdrService`, the tRPC read and webhook intake). These are two services because their dependency sets are disjoint.
- `cdr.repository.ts` and `cdr.schema.ts`.
- `cdr.redbark.ts`: the `interface RedbarkClient` + `class HttpRedbarkClient`.

This supersedes the design doc's stale `makeRun*(deps)` note, written before [adr004](adr004-domain-oriented-3-tier-server-architecture.md)'s 2026-09-09 revision ended the earlier deferral and reinstated the 3-tier as the live pattern.

Under [adr022](adr022-cross-domain-data-through-the-owning-service.md), `cdr.repository.ts` touches only `cdr_sync_state`. Each other write goes through the domain that owns it, as a `Pick` port:

- The scoped upsert is `TransactionsService.upsertSynced`.
- The anchor insert is `BalancesService.recordSynced`.

So no `db.transaction()` spans both domains. Instead, **ordering keeps the invariant**: per account, the upsert runs first, and the high-water mark advances only after it succeeds.

- If the upsert throws, the cursor stays put.
- If the run dies between the two writes, the next run re-fetches the same window, and the idempotent upsert absorbs it.

Either way the cursor never passes un-ingested rows. Each account syncs in isolation: a failing account records `lastError`, the rest still sync, and the run then throws. Inngest retries the whole idempotent run only when a failure was transient; a deterministic one (a mapping throw, a `4xx`) fails at once, and the next daily run tries again. Sync writes take **no outbox event**: the cron is the trigger, and receipt matching is read-time, so no consumer needs one. `cdr-sync`'s id + cron (and later `cdr-connection-changed`'s) are pinned in `registry-golden.test.ts`.

**Credential & consent posture.** One `rbk_live_…` bearer key in `REDBARK_API_KEY` — **optional, not `requiredInProd`**: CDR is not core, so an unset key makes the cron a no-op. `Redbark-Version` is pinned as a **code constant**, not env (a version bump can change parsing; it moves through code review + a test). The key is a **Vercel dashboard secret**, like `RESEND_API_KEY`. It is not one of the Terraform-written vars ([adr013](adr013-terraform-owned-vercel-deployments.md); `infrastructure/vercel.tf` leaves dashboard secrets where they are). The webhook signing secrets follow the same path. Failure posture is asymmetric (an outbound echo of [adr007](adr007-asymmetric-failure-posture-in-the-redis-adapter.md)): transient errors (network, 5xx, `429`) retry with backoff honoring `Retry-After`; consent death (`revoked|expired|invalidated`) is terminal — write `connectionStatus`, stop that connection's accounts, surface it; `expiring` is a soft warning. This differs from [adr006](adr006-redis-session-cache-with-postgres-durable-copy.md)/adr007, which govern *inbound session* creds cached in Redis with fail-open/fail-closed on a cache miss. Here there is a single *outbound* key and consent lifecycle is a first-class business state, not a cache miss.

### Positive Consequences

- The local ledger stays authoritative; synced rows are ordinary `transaction` rows, so expense links, categorisation, receipts, and the projection work unchanged.
- Re-ingestion is idempotent by construction (partial unique index + high-water-mark + settled-only), so poll and future webhooks are interchangeable, raceless triggers.
- Member edits survive re-sync — the scoped `ON CONFLICT` update and INSERT-only `description` protect every editable column.
- A beta API's undocumented sign fails loud (direction-vs-numeric cross-check) rather than mis-posting a refund as a purchase.
- The provenance columns are paid for once and also serve future `paypal` and manual `import` provenances.
- Synced Spend with no link lands in the **Unplanned** queue, reusing the existing "absence of a plan is derived" flow — no new surface.

### Negative Consequences

- **Internal transfers double-count.** Linking two household accounts surfaces a transfer as paired Spend + Inflow. Transfer-filtering is explicitly deferred to a later design.
- **Cross-provenance consolidation is unsolved.** The unique index dedups within a provenance only; the same purchase arriving as both `cdr` and `paypal` (or overlapping a manual `import`) is not merged. The one known overlap — the account manually imported since January — is avoided by seeding its high-water-mark; the general case is out of scope.
- **Balance anchor reflects linked accounts only.** Unlinked money is left out, and a typed balance that includes it is replaced at the next sync. An account with an unknown `type` counts only once set by hand.
- **The sign rule is observed, not documented.** A live spike confirmed it (facet 4), but RedBark could change it silently; the direction-vs-sign cross-check is the guard.
- Denormalized `connectionStatus` will want promoting to a `cdr_connection` table if the project launches publicly and households manage their own connections on `/settings`.
- RedBark's hierarchical categories are not adopted; synced rows land uncategorised pending a later review of that taxonomy.

## Pros and Cons of the Options

### 1. App store-of-record; poll-first; provenance-keyed dedup

```mermaid
flowchart LR
  cron["cdr-sync cron<br/>(daily, concurrency 1)"] --> svc["CdrSyncService.run()<br/>idempotent"]
  wh["webhook (later)<br/>transactions.synced"] -. same trigger .-> svc
  svc -->|"per account: GET /transactions<br/>from=hwm-14d, include_pending=false"| rb[("RedBark v2")]
  svc -->|"one GET /balances<br/>every live account"| rb
  svc -->|"1. TransactionsService.upsertSynced<br/>ON CONFLICT (provenance, externalId)<br/>DO UPDATE bank-owned only"| tx[("transaction")]
  svc -->|"2. advance highWaterMark<br/>(monotonic)"| st[("cdr_sync_state")]
  svc -->|"latest balance per account"| st
  svc -->|"BalancesService.recordSynced<br/>sum current, if all fresh"| bal[("balance_snapshot")]
  tx --> unplanned["Unplanned queue<br/>(member links → Expense)"]
```

| Pros | Cons |
| --- | --- |
| Local ledger authoritative; everything downstream unchanged | Provenance columns + a new table + a new domain to build |
| Idempotent; poll and webhook interchangeable | Transfers and cross-provenance dedup left unsolved |
| Member edits protected by scoped upsert | Balance anchor covers linked, counted accounts only |
| Degrades safely on a beta API (fail-loud sign, freshness gate, optional key) | Sign rule observed, not documented (cross-check guards it) |

### 2. RedBark as store-of-record / on-demand mirror

- Bad, because every read couples to a beta external API and its rate limits (`cheap` 60/min).
- Bad, because expense-link FKs, receipt matches, and manual entry have no external row to attach to — it breaks the existing model.
- Bad, because offline / API-down means no ledger at all.
- Good, because there is nothing to sync or dedup.

### 3. Webhook-push-only

- Bad, because a missed or failed delivery is a silent gap with no backstop, on a beta service of unknown reliability.
- Bad, because backfill and re-derivation still need a pull path, so this doesn't remove polling — it just hides it.
- Good, because latency to new rows is lower than a daily poll — which is why it is retained as an *additive* trigger in option 1, not the primary one.

### 4. Manual CSV import only (status quo)

- Good, because zero new code, zero external dependency.
- Bad, because it is exactly the manual toil this feature exists to remove.

## Open Questions

- ~~**REST amount sign convention.**~~ Resolved 2026-10-16 by a live spike, since RedBark has no sandbox: debits are negative and credits positive (facet 4).
- ~~**Balance anchor scope.**~~ Resolved 2026-10-19: a per-account `inBalance` flag, defaulted from `type`. Credit cards count, loans don't (facet 6).
- **RedBark v2 is in beta** (`2026-10-01.wattle`). Endpoint shapes and enums may shift; the `RedbarkClient` adapter isolates the blast radius, but GA should be confirmed before production sync.
- **Transfer-filtering** and **general cross-provenance consolidation** are deferred to their own designs.

## Links

- Design: [Expense Linking, Receipts, Cash Flow — Roadmap Design](../../thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md)
- Builds on [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — outbox + Inngest rails
- Builds on [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — 3-tier domain architecture (`receipts/` reference)
- Builds on [adr005](adr005-per-domain-drizzle-schema-files.md) — per-domain Drizzle schema files
- Builds on [adr021](adr021-trpc-router-is-the-controller-tier.md) — `<domain>.<transport>.controller.ts` names
- Builds on [adr022](adr022-cross-domain-data-through-the-owning-service.md) — cross-domain writes through the owning service; replaces the per-account `db.transaction()` with write ordering
- Contrasts with [adr006](adr006-redis-session-cache-with-postgres-durable-copy.md) / [adr007](adr007-asymmetric-failure-posture-in-the-redis-adapter.md) — inbound session creds vs an outbound API key + consent lifecycle
- Contrasts with [adr014](adr014-bedrock-via-vercel-oidc.md) — Bedrock's OIDC-exchanged creds vs a static outbound key
- Vendor docs: [RedBark API v2 overview](https://redbark.com/docs/api-reference/v2/overview)
