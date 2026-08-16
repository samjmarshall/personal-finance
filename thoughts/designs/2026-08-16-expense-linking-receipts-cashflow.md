# Expense Linking, Receipts, Cash Flow — Roadmap Design

**Date:** 2026-08-16
**Status:** Validated in brainstorm session; not yet planned/ticketed
**Scope:** Full feature list (Must + Should + Nice-to-have), designed together so the data model never needs a redo. Build order staged; Nice-to-haves are designed-for, not built.

## Feature list (MoSCoW)

- **Must:** Link transactions to expenses; Unplanned Expenses page; Expenses nav section (Planned / Unplanned / Categories)
- **Should:** Receipt/invoice extraction (upload + email); one-time budgets with expected consumption date; cash flow chart (historic + projected)
- **Nice:** Daily CDR bank sync (e.g. Redbark); PayPal API sync; non-salary income support

## Prior art adopted

Both unexecuted 2026-08-11 plans are still valid and are **adopted as written**:

- `thoughts/plans/2026-08-11-transaction-expense-mapping.md` — nullable `transaction.expenseId` FK → `expense.id`, `ON DELETE SET NULL`, leftJoin reads (no `relations()`), Zod input in `transactions-schemas.ts`, expense picker in transaction form.
- `thoughts/plans/2026-08-11-transaction-expense-category-fk.md` — nullable `transaction.expenseCategoryId` FK → `expense_category.id`, `ON DELETE SET NULL` + index; free-text `category` column stays, no backfill.

## Decisions (interview outcomes)

1. **Link shape: single nullable FK** (`transaction.expenseId`), not a split/allocation table. Per-item granularity comes later from receipt line items (`receipt_item.expenseId`) — receipts automate what a split-editor UI would make manual.
2. **Unplanned is a view, not a record.** Unplanned = Spend transaction (`amount > 0`) with `expenseId IS NULL`. Absence of a plan is derived, can't drift, nothing to maintain.
3. **One-time budgets live in the `expense` table** behind a `kind` discriminator, so the one transaction FK covers both kinds. Rejected: separate table (needs a second FK or polymorphic link, doubles every "is this planned?" query).
4. **Projection timing = optional columns, not schedules.** Nullable `dueDay`/`dueMonth` on expense/income; cadence from the entered Basis; untimed rows smear evenly. Rejected: RRULE-style occurrence table (YAGNI), pure smear (hides the annual-premium spike the chart exists to show).
5. **Cash flow = bars + running balance line**, anchored on a manually maintained `balance_snapshot`. Stale anchor shifts the line only; bars stay truthful. CDR can auto-update the anchor later.
6. **Async platform: outbox + Inngest per ADR002/ADR003** — first real implementation of the ADR. Chosen over inline processing and Vercel Workflow because future workloads (CDR sync, PayPal sync) ride the same rails.
7. **Receipt↔transaction matching: auto-suggest, human confirms.** Never silent auto-link (wrong links poison budget attribution invisibly; receipt amounts ≠ settled amounts often enough). Suggestions computed **at read time**, not stored — always fresh as imports land.
8. **Email ingestion: strict sender allowlist, drop unknowns** (logged, no receipt row, no Claude spend). Rejected quarantine: spam-review chore for a ~2-entry allowlist.
9. **Transaction provenance columns now** (`source`, `externalId`, `accountName`) — dedup pays off immediately for manual statement imports; it's the entire schema cost of CDR/PayPal later.
10. **Income mirrors expense shape** (`kind`, `amount`, `expectedDate`, `dueDay`/`dueMonth`) but **no `transaction.incomeId`**. Reconciliation wasn't an ask, and combined salary+commission deposits would force one-to-many transaction→income — not worth it.
11. **Category FK plan rides along** — Unplanned grouping, receipt-item categorisation, and cash-flow drill-down all inherit reliable FK grouping instead of the "groceries"/"Groceries" soft join.

## Data model

### Modified tables (all changes additive + nullable; no backfill)

**`transaction`**
- `expenseId` int null, FK → `expense.id`, `ON DELETE SET NULL` (plan 1)
- `expenseCategoryId` int null, FK → `expense_category.id`, `ON DELETE SET NULL`, indexed (plan 2)
- `source` text not null default `'manual'` — `manual | import | cdr | paypal`
- `externalId` text null; `accountName` text null; unique index `(source, externalId)`
- Free-text `category` stays.

**`expense`**
- `kind` text not null default `'recurring'` — `recurring | one-time`
- `amount` double null (one-time only); `expectedDate` timestamp null (one-time only)
- `dueDay` int null (1–31); `dueMonth` int null (1–12)
- Recurring rows keep fortnight/month/year + Basis semantics untouched.

**`income`** — same five columns as expense, same meanings (`dueDay`/`dueMonth` = payday).

### New tables

- **`balance_snapshot`** — `amount`, `asOf`. Latest row anchors the projection line.
- **`receipt`** — `status` (`pending | processed | failed`), `source` (`upload | email`), `userId` FK (member), blob pathname/URL, `contentHash` (dup detect), extracted `vendor` / `receiptDate` / `total` / `currency`, `rawJson`, `error`, `transactionId` int null FK (the confirmed match), timestamps. **No expiry** — receipts keep forever (tax).
- **`receipt_item`** — `receiptId` FK cascade, `name`, `price`, `quantity`, `expenseId` null FK (per-item budget attribution), `expenseCategoryId` null FK.
- **`allowed_sender`** — `email` unique, `userId` FK.
- **`app_setting`** — key/value; holds `fortnightAnchor` (household pay-cycle grid anchor — `dueDay` can't encode fortnightly cadence).
- **`outbox`** — per ADR002/ADR003 (event name, payload, delivered markers).

Household scoping: all new tables follow the current unscoped pattern; `householdId` remains a separate future effort and nothing here blocks it.

## Navigation & pages

**Nav** (`src/app/_components/app-nav.tsx`): "Expenses" becomes a parent —
Planned/Budgeted → `/expenses` (default, existing) · Unplanned → `/expenses/unplanned` (new) · Categories → `/expenses/categories` (existing). "Receipts" → `/receipts` top-level (new). Transactions, Income, Dashboard unchanged.

**Planned page** — each expense row gains an **actual** column (sum of linked transactions in the viewed period) beside budget, over-budget highlighted. New "One-time" section: name, amount, expected date, consumed (linked-transaction sum), remaining. Past-date one-timers collapse into a "past" group — date does the work, no archive flag.

**Unplanned page** — Spend transactions with `expenseId IS NULL`, grouped by category with totals, fortnight/month period picker. Inline "link to expense" picker per row — linking removes the row. Unlinked refunds (negative) net against their category group total.

**Transactions page** — form gains expense picker + category picker per plans 1 & 2 (list-driven; categories never invented mid-entry, honoring the glossary rule). List shows linked expense name via leftJoin.

**Receipts page** — history table: thumbnail, vendor, total, date, member, status + retry button on failed. Detail: image beside extracted items; match-suggestion banner with one-click confirm; after matching, per-item expense/category pickers. Filter for processed-but-unmatched = the to-do queue.

**Dashboard** — cash flow chart as top panel; balance snapshot beside it with inline "update balance" field.

## Infrastructure: outbox + Inngest

First real implementation of ADR002/ADR003:

- `outbox` table + `src/server/outbox/` — `publish()` and `commitWithOutbox(writes, events)` executed as one `db.batch()` on neon-http (ADR003 atomicity). `outbox-sweep` cron delivers pending events to Inngest at-least-once, idempotent on row id; `outbox-prune` clears delivered rows.
- `src/server/inngest/` — client, `events.ts` registry (`receipt/uploaded`, `receipt/email.received`, `receipt/retry`), functions registry served from one route handler.
- New deps: `inngest`, `@vercel/blob`, `resend` (inbound), `ai` + `@ai-sdk/anthropic`.

Flow shape: tRPC mutation (or webhook) writes canonical rows + outbox event in one batch → sweep delivers → worker processes → worker writes results. Retries/backoff from Inngest; receipt `status` is the user-visible truth.

**Deliberate deviation from ADR004:** existing routers are plain tRPC files with direct db calls — no service/repository/module ceremony exists in this repo. This design stays in the current style and does **not** smuggle a 3-tier refactor into the feature. Workers are `makeRun*(deps)` factories (pure core, thin `createFunction` wrapper) purely for testability. The ADR004-vs-reality gap is flagged as an ADR candidate below, not resolved here.

## Receipt pipeline

**Upload path:** Receipts page uses Vercel Blob client upload (`handleUpload` route; token generation checks session). On complete: one batch writes `receipt` row (`pending`, `source: upload`, member from session) + `receipt/uploaded` outbox event.

**Email path:** one Resend inbound address; each member forwards from their personal email. Webhook route → verify signature → sender lookup in `allowed_sender`. Unknown: log, drop, 200. Known: each attachment (PDF/JPG/PNG) stored to Blob, one receipt row per attachment; no attachment → the HTML body is the payload (Uber/Amazon e-receipts). Same batch write + event, `source: email`, member from sender.

**Worker `process-receipt`:** fetch payload → `contentHash`; hash match on an existing receipt → `failed` "duplicate of #id" (no Claude spend). Otherwise Claude via AI SDK `generateObject` (Sonnet, vision; PDF supported) against a Zod schema: metadata (vendor, date, total, currency) + line items. Prompt includes the household's category list so items arrive with prefilled `expenseCategoryId` — user-correctable, never invented (unknown → null). Writes receipt fields + `receipt_item` rows → `processed`. Failure → `failed` + `error`; retry button emits `receipt/retry` → same worker.

**Matching & attribution (read-time):** receipt detail queries candidate transactions — amount exact or ±2%, date ±4 days, not already receipt-linked — ranked. Confirm sets `receipt.transactionId`. Per-item `expenseId` pickers then answer "*what* pushed Groceries over."

**Rejected for the pipeline:** a dedicated OCR backend (AWS Textract) — Claude Vision alone covers household volume; presigned-URL upload flow — Blob client upload replaces it; outbound webhooks and a standalone API surface — everything is in-app tRPC; any retention expiry — receipts keep forever.

## Cash flow chart

**Server query** `cashflow.get`, buckets fortnight (default, grid from `fortnightAnchor`) or month; 12 months back, 12 forward.

*Historic* — actual transactions: spend = Σ positive amounts, inflow = Σ negatives (glossary signs).

*Projected* — expenses + income walked forward:

- fortnight-basis → every grid fortnight
- month-basis + `dueDay` → spike in that date's bucket; untimed → smeared
- year-basis + `dueMonth` (+`dueDay`) → annual spike; untimed → smeared
- one-time → **remaining** (amount − linked spend) in `expectedDate`'s bucket; past-date rows drop out

**Balance line** — latest `balance_snapshot` is the pivot: forward = anchor + cumulative projected net; backward = anchor − actual transaction net. Continuous across today; no snapshot → bars only.

**UI** — existing chart stack (shadcn/Recharts, as `monthly-spend-chart`). Inflow bars up, spend bars down, balance line overlay, today marker. Tooltip lists a bucket's contributing items ("Car insurance $1,400 · Rates $600…"). Dip-below-zero buckets tinted as a warning.

## Error handling

- Migrations additive + nullable — no backfill, no downtime risk.
- `ON DELETE SET NULL` invariant: deleting an expense returns its transactions to Unplanned automatically — nothing orphans.
- Outbox is at-least-once → workers idempotent: re-delivery re-checks status/hash before spending Claude tokens.
- Extraction: Zod-validated; items-sum ≠ total shows a mismatch badge, doesn't fail the receipt.
- Email: signature verify → allowlist → drop unknowns, logged.
- Missing balance/cadence data → chart degrades (smear / bars-only), never errors.

## Testing (`make test`)

- Projection bucketing = pure function, table-driven tests (fortnight anchor math, dueDay spikes, one-time remaining, smear fallback) — highest-risk logic.
- Match-candidate filter = pure function + tests (tolerance, date window, already-linked exclusion).
- Zod input schemas per plan 2's TDD pattern; workers via `makeRun*(fakeDeps)` — no Inngest in tests.
- Manual eval: ~10 real household receipts run through the worker before trusting category prefill.

## Build order (each stage ships alone)

1. **Must Have:** plans 1+2 migrations, transaction form pickers, Unplanned page, nav restructure — zero new infra
2. Expense/income `kind` + timing columns, one-time UI on Planned page
3. Cash flow chart + balance snapshot
4. Outbox + Inngest rails
5. Receipts: upload → worker → page → matching
6. Email ingestion
7. **Future (designed-for, not built):** CDR (Redbark) + PayPal = new `source` values + sync workers on stage-4 rails; income-reconciliation FK only if the itch ever appears

## ADR Candidates

Run `/domain-model thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` to capture these as Proposed ADRs.

- **Adopt outbox + Inngest as the async execution platform** — weighed against inline processing and Vercel Workflow; long-lived infra choice that future workloads (CDR, PayPal) depend on; also converts ADR002 from paper to practice.
- **Transaction→expense linking is a single nullable FK; per-item granularity via receipt line items** — weighed against an allocation/split table; the data-model spine every feature here sits on.
- **One-time budgets live in `expense` behind a `kind` discriminator** — weighed against a separate table; shapes the FK model and every planned-vs-actual query.
- **Feature code stays plain-router style; ADR004's 3-tier ceremony deferred** — a decision *about* an Accepted ADR the codebase never implemented; needs recording so the gap is deliberate, not drift.

## Terminology TODO

Run `/domain-model thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` to persist these to `CONTEXT.md`.

- **Expense** — widened: "standing commitment" → "a commitment to Spend, either standing (Basis figures) or one-time (amount + expected consumption date)".
- **Unplanned** — new term: a Spend Transaction not linked to any Expense; defined by absence, never a stored record type.
- **Receipt** — new term: an evidence document (image/PDF/e-receipt) attributed to a member, holding line items, matched to at most one Transaction.
- **Timing vs Basis** — Basis stays "the cadence a figure was entered at"; timing (`dueDay`, `dueMonth`, fortnight anchor) is *when it lands*, a separate optional attribute.
- **Provenance / source** — where a Transaction came from (`manual | import | cdr | paypal`), distinct from Frequency and Priority.
