# Expense Linking Stage 5 — Receipts (upload → worker → page → matching) Implementation Plan

## Context

Stage 4 shipped the outbox + Inngest rails but wired **no producer** — `commitWithOutbox`/`publish` are tested-but-unwired and the `receipt/*` event names exist with provisional payloads (`src/server/inngest/events.ts:9-13`). Stage 5 lights up the first real producer: a household member uploads a receipt image/PDF, a `process-receipt` worker extracts vendor/total/date + line items with Claude Vision, and a Receipts page lets the member confirm which Transaction the receipt matches and attribute each line item to an Expense/Category. This delivers the "per-item granularity via Receipt line items" half of [adr010](../../docs/adr/adr010-single-nullable-fk-transaction-expense-link.md).

## Current State

- **Rails, ready to consume:** `commitWithOutbox(writes, events)` and `publish(event)` wired singletons at `src/server/outbox/index.ts:8-11`; `buildOutboxEvent(name, payload)` mints a registry-validated descriptor at `src/server/inngest/events.ts:27-36`. Worker convention is a pure `makeRun*(deps)` core + thin `make*Worker(deps)` `createFunction` wrapper, registered in the `functions` array at `src/server/inngest/functions.ts:12-15` and served at `src/app/api/inngest/route.ts:12` (`maxDuration = 300` at `:10`). Golden test pins event names + function ids at `src/server/inngest/registry-golden.test.ts:14-21`.
- **Event names already frozen:** `receipt/uploaded`, `receipt/retry`, `receipt/email.received`, all payload `{ receiptId: z.string() }` — provisional, invited to firm in stage 5 (`src/server/inngest/events.ts:6-13`).
- **Schema homes (adr005):** per-domain `src/server/<domain>/<domain>.schema.ts`, glob-discovered, spread-merged in `src/server/db/index.ts`. Integer identity PK + `doublePrecision` money + `references(() => x.id, { onDelete })` + timestamp `$defaultFn`/`$onUpdate` idioms at `src/server/transactions/transactions.schema.ts:15-45`; `pgEnum(Object.values(Enum) as [..])` at `:6-9`; inline `.unique()` at `src/server/expenses/categories.schema.ts:9`; partial index at `src/server/outbox/outbox.schema.ts:19-26`.
- **Managed vocab:** TS string enums + `to*` coercers in `src/lib/constants.ts:10-44`.
- **DTO/domain:** `src/domain/<domain>/{<domain>.dto.ts, <domain>.dto.test.ts, <domain>.interface.ts, index.ts}`; shared `*Fields` spread into create/update DTOs (`src/domain/expenses/expense.dto.ts:6-18`); compile-time contracts via `Expect`/`WritesInto` from `src/test/type-contracts.ts` (`src/domain/expenses/expense.dto.test.ts:1-10`).
- **Routers (adr012 plain-router):** `createTRPCRouter` + `protectedProcedure` + direct `ctx.db`, registered in `src/server/api/root.ts:15-23`; helpers `assertRow` (`src/server/api/lib/assert-row.ts`) and `isPgError(error, "23505"/"23503")` (`src/server/api/lib/pg-error.ts`); leftJoin read at `src/server/api/routers/transaction.ts:98-119`; FK-conflict rethrow at `:47-52`; `ctx.session.user.id` available.
- **Auth:** `user` table has `id text primaryKey` (`src/server/auth/auth.schema.ts:6-7`) — the `receipt.userId` FK target.
- **Env:** `src/env.js` `requiredInProd(z…)` for prod-only secrets (`:5-6`, `:45-46`) + matching `runtimeEnv` entry (`:73-84`).
- **Pages:** RSC prefetch + `HydrateClient` (`src/app/(dashboard)/transactions/page.tsx:1-18`); client view uses `useSuspenseQuery`/`useQuery`/`useMutation` + `RouterOutputs` (`src/app/_components/transactions/transactions-view.tsx`); nav `links` array at `src/app/_components/app-nav.tsx:25-42`.
- **Not present yet:** `@vercel/blob`, `ai`, `@ai-sdk/anthropic` (not installed); no `receipt`/`receipt_item` tables; no receipts router/page/route.

## Desired End State

A member visits **`/receipts`**, uploads an image or PDF, and sees it appear as `pending`. Within seconds the worker flips it to `processed` with extracted vendor/total/date + line items (categories prefilled from the household list), or `duplicate` (same photo, no AI spend), or `failed` (with a retry button). Opening a receipt shows the image beside its items and a ranked match-suggestion banner; one click confirms the Transaction link, after which each line item gets Expense/Category pickers. Blurry/junk receipts are destructively deletable on any status. All of this runs on the stage-4 outbox rails; `make check` and `make test` pass.

## Out of Scope

- **Email ingestion** (`resend` inbound, `allowed_sender` table, `receipt/email.received` producer, sender allowlist) — **stage 6**. The `channel` enum defines `email` now so stage 6 adds no migration, but nothing produces it here.
- **`balance_snapshot`, `app_setting`** tables — already shipped (stage 3: `src/server/balances/balances.schema.ts`, `src/server/settings/settings.schema.ts`).
- **Cash-flow chart** work — stage 3, unaffected.
- Auto-linking receipts to transactions (design decision 7: human confirms; never silent).
- Retention/expiry, OCR backend, presigned-URL flow, outbound webhooks (design "Rejected for the pipeline").
- Household `manual eval` of ~10 real receipts (design testing §) — a follow-up validation task, not a code phase.

## Approach

Five vertical slices matching the design's arrows: **schema → upload → worker → page → matching**. Each slice ships its own tests. New tables are `receipt` + `receipt_item` only. Row creation on upload goes through a tRPC `receipt.create` mutation (not Blob's `onUploadCompleted`, which never fires on localhost) so the producer is unit-testable and dev works; the Blob `handleUpload` route only mints the token behind a session check. The worker follows the established pure-core/thin-wrapper factory split with all I/O (blob fetch, AI call) injected, so `make test` needs no network. Matching is read-time and its tolerance/window/exclusion logic is a pure, table-tested function. The two stage-5 outbox payloads firm from `{ receiptId: string }` to `{ receiptId: number }` (integer PK; stage 4 flagged payloads provisional; golden test pins names only).

---

## Phase 1: Schema — `receipt` + `receipt_item` tables

### Changes
- `src/lib/constants.ts` — add `enum ReceiptStatus { Pending="pending", Processed="processed", Failed="failed", Duplicate="duplicate" }` and `enum ReceiptChannel { Upload="upload", Email="email" }`, each with a `to*` coercer mirroring `toCommitmentKind` (`:48-54`). **Dropped in impl** (e129af4): both columns are pgEnums, so the DB can't hold an out-of-vocab value and the coercers defended against something that can't happen. Enums landed; no `toReceiptStatus`/`toReceiptChannel`.
- ~~`src/lib/constants.test.ts` — coercer cases~~ — moot once the coercers were dropped.
- `src/server/receipts/receipts.schema.ts` — new file (glob-discovered). Two tables:
  - `receipts` ("receipt"): `id` integer identity PK; `status` `receiptStatus()` pgEnum notNull default `pending`; `channel` `receiptChannel()` pgEnum notNull default `upload`; `userId text notNull references(() => user.id, { onDelete: "cascade" })`; `blobUrl text notNull`; `blobPathname text notNull`; `contentType text`; `contentHash text`; `vendor text`; `receiptDate date` (calendar, string mode — [[calendar-dates-cross-wire-as-strings]]); `total doublePrecision`; `currency text`; `rawJson jsonb`; `error text`; `transactionId integer references(() => transactions.id, { onDelete: "set null" })`; `duplicateOfId integer references((): AnyPgColumn => receipts.id, { onDelete: "set null" })` (self-ref); `createdAt`/`updatedAt` per the `$defaultFn`/`$onUpdate` idiom. Indexes: unique `receipt_transaction_unique` on `transactionId` (nulls-distinct → unmatched rows never collide; a blocked 2nd non-null match is the dup-photo catcher), `receipt_content_hash_idx` on `contentHash`, `receipt_status_idx` on `status`, `receipt_user_idx` on `userId`.
  - `receiptItems` ("receipt_item"): `id` integer identity PK; `receiptId integer notNull references(() => receipts.id, { onDelete: "cascade" })`; `name text notNull`; `price doublePrecision notNull`; `quantity doublePrecision notNull default 1`; `expenseId integer references(() => expenses.id, { onDelete: "set null" })`; `expenseCategoryId integer references(() => expenseCategories.id, { onDelete: "set null" })`; `createdAt`/`updatedAt`. Index `receipt_item_receipt_idx` on `receiptId`.
  - pgEnums `receiptStatus`/`receiptChannel` defined per `src/server/transactions/transactions.schema.ts:6-9`.
- `src/server/receipts/receipts.schema.test.ts` — `getTableColumns` assertions (notNull/hasDefault/nullable per column), mirroring `src/server/outbox/outbox.schema.test.ts`.
- `src/server/db/index.ts` — import + spread-merge `receiptsSchema` into the schema object (mirror the outbox import lines).
- `src/domain/receipts/receipt.interface.ts` — `Receipt`, `ReceiptItem` TS types (mirror `src/domain/transactions/transaction.interface.ts`).
- `src/domain/receipts/index.ts` — barrel export.
- `drizzle/00NN_*.sql` — generated by `make db_generate` (do not hand-write).

### Success
- [x] `make check` passes (`db:check` sees no drift after generate)
- [x] `make test` passes (schema-shape + coercer tests)
- [x] `make db_generate` produces one additive migration (two `CREATE TABLE`, two enums, indexes; no changes to existing tables)
- [x] **User runs** `make db_migrate` against the feature-branch DB ([[db-migrate-and-env-are-user-run]]; never on `main`/prod)

---

## Phase 2: Upload rail + `receipt.create` producer

### Changes
- `package.json` — add dep `@vercel/blob` (via `pnpm add`).
- `src/env.js` — add `BLOB_READ_WRITE_TOKEN: requiredInProd(z.string())` to `server` (`:13-58`) + matching `runtimeEnv` entry (`:73-84`).
- `src/domain/receipts/receipt.dto.ts` — `receiptCreateDto = z.object({ blobUrl: z.url(), blobPathname: z.string().min(1), contentType: z.string().optional() })` (client sends blob coordinates only; `userId`/`status`/`channel` are server-set). Follow the `*Fields`-spread shape of `src/domain/expenses/expense.dto.ts:6-18`.
- `src/domain/receipts/receipt.dto.test.ts` — **written first** (TDD): compile-time `Contracts` tuple `Expect<WritesInto<z.infer<typeof receiptCreateDto> & { userId: string; status: ReceiptStatus; channel: ReceiptChannel }, Receipt>>` + runtime parse cases (rejects non-URL, empty pathname), mirroring `src/domain/expenses/expense.dto.test.ts:1-10`.
- `src/app/api/receipts/upload/route.ts` — POST handler using `handleUpload` from `@vercel/blob`. `onBeforeGenerateToken`: resolve session the same way `createTRPCContext` does (`src/server/api/trpc.ts:33`), throw if unauthenticated; return `{ allowedContentTypes: ["image/jpeg","image/png","application/pdf"], maximumSizeInBytes, addRandomSuffix: true, tokenPayload: JSON.stringify({ userId }) }`. `onUploadCompleted`: no-op comment noting the row is created by `receipt.create` (webhook doesn't fire on localhost).
- `src/server/inngest/events.ts` — firm `receipt/uploaded`, `receipt/retry`, `receipt/email.received` payloads from `z.object({ receiptId: z.string() })` to `z.object({ receiptId: z.number().int() })` (`:10-12`). Keys unchanged.
- `src/server/inngest/events.test.ts` — update the payload contract assertions (`:33-41`) to `{ receiptId: number }`.
- `src/server/api/routers/receipts.ts` — new router. `create: protectedProcedure.input(receiptCreateDto).mutation` calls `commitWithOutbox(writes, (row) => events)` (imported from `~/server/outbox`): the `writes` callback inserts one `receipts` row (`status: pending`, `channel: upload`, `userId: ctx.session.user.id`, blob fields) with `.returning()`; the events fn derives `[buildOutboxEvent("receipt/uploaded", { receiptId: row.id })]` from the returned row. Return the inserted `Receipt`.
- `src/server/api/root.ts` — register `receipt: receiptRouter` (`:15-23`).
- `src/app/_components/receipts/receipt-upload.tsx` — client component: `upload(pathname, file, { access: "private", handleUploadUrl: "/api/receipts/upload", contentType })` from `@vercel/blob/client` (private store — anonymous GET 400s), then `api.receipt.create.mutate({ blobUrl, blobPathname, contentType })` and invalidate the receipts list. Pre-processes the pick via `prepReceipt`: transcodes HEIC→JPEG, compresses images; PDFs pass through.

### Changes — tests
- `src/server/api/routers/receipts.create.test.ts` — inject a fake `commitWithOutbox` (per `src/server/outbox/commit.test.ts` fake pattern) and assert: one receipt row written with server-set `status/channel/userId`; exactly one `receipt/uploaded` event minted carrying the returned `row.id` as a **number**.

### Success
- [x] `make check` passes
- [x] `make test` passes (DTO contract + producer test + updated events test + golden test still green)
- [x] `SKIP_ENV_VALIDATION=1 pnpm run build` succeeds ([[make-build-needs-prod-env-locally]])
- [x] User adds `BLOB_READ_WRITE_TOKEN` to `.env`
- [x] Add `BLOB_READ_WRITE_TOKEN` to `.env.example` ([[staging-env-example-past-the-block-hook]])
- [x] Uploading a JPG/PNG/PDF creates a `pending` row; a non-allowed type is rejected by the token route (wire `<ReceiptUpload />` on a temp page or wait for Phase 4's `/receipts`)
- [x] Unauthenticated POST to `/api/receipts/upload` is rejected
- [x] `/security-review` (touches `src/env.js`, auth session in a route handler, blob token minting)

---

## Phase 3: `process-receipt` worker (extract + dedup)

### Changes
- `package.json` — add deps `ai` (^5) + `@ai-sdk/anthropic` (^2 — v4 ships the `LanguageModelV4` provider spec `ai@5` can't consume; v2 shares `@ai-sdk/provider@2`).
- `src/env.js` — add `ANTHROPIC_API_KEY: requiredInProd(z.string())` to `server` + `runtimeEnv`.
- `src/server/receipts/extraction.ts` — the Zod extraction schema (`vendor: string`, `receiptDate: YYYY-MM-DD string`, `total: number`, `currency: string`, `items: { name, price, quantity, expenseCategoryId: number | null }[]`) kept simple (Anthropic constrained decoder strips string/array constraints into descriptions) + a `buildExtractionPrompt(categories)` that lists the household `expense_category` names/ids so items arrive with a prefilled `expenseCategoryId` (unknown → null, never invented). `RECEIPT_MODEL = "claude-sonnet-4-6"` constant.
- `src/server/receipts/extraction.test.ts` — **written first**: schema parses a well-formed object; rejects malformed; unknown category → `null`.
- `src/domain/receipts/receipt-total.ts` — pure `itemsTotalMismatch(total, items): boolean` (Σ price·quantity vs total, tolerance) for the UI badge (design error-handling: mismatch badges, never fails the receipt).
- `src/domain/receipts/receipt-total.test.ts` — table-driven (match, mismatch, empty items, rounding).
- `src/server/receipts/receipts.workers.ts` — new file, two-layer per `src/server/outbox/outbox.workers.ts:36-100`:
  - `makeRunProcessReceipt({ db, fetchBlob, generate, hash })` pure core `runProcessReceipt(receiptId: number)`:
    1. Load receipt; if `status ∈ {processed, duplicate}` → return (idempotent re-delivery, no spend).
    2. `fetchBlob(blobUrl)` → bytes + mediaType; `hash(bytes)` (sha256 hex); persist `contentHash`.
    3. Query other receipts with same `contentHash`, `id != self`, `status ∈ {processed, duplicate}`; if found → set `status: duplicate`, `duplicateOfId`, return (no AI spend).
    4. Else `generate({ model, schema, prompt, file/image part })` (real wrapper calls `generateObject`, `result.object`); in one `db.transaction`: update receipt (`vendor/receiptDate/total/currency/rawJson`, `status: processed`) + insert `receiptItems`.
    5. On any throw in step 4 → `status: failed`, `error` text.
  - `makeProcessReceiptWorker({ db, inngest })` wrapper: builds the core with real `fetch`-based `fetchBlob`, a `generate` that calls `generateObject({ model: anthropic(RECEIPT_MODEL), schema, messages })`, and node `crypto` sha256; `inngest.createFunction({ id: "process-receipt", ... }, [{ event: "receipt/uploaded" }, { event: "receipt/retry" }], ({ event }) => runProcessReceipt(event.data.receiptId))`.
- `src/server/inngest/functions.ts` — build `processReceiptWorker` and append to the `functions` array (`:12-15`).
- `src/server/inngest/registry-golden.test.ts` — add the frozen `process-receipt` entry (id + its two event triggers) to the spy-driven assertion (`:28-46`).

### Changes — tests
- `src/server/receipts/receipts.workers.test.ts` — hand-rolled fake `db` + injected `fetchBlob`/`generate`/`hash` (per `src/server/outbox/outbox.workers.test.ts:22-63`). Cases: happy path writes items + `processed`; hash match → `duplicate` + `duplicateOfId`, `generate` never called; already-`processed` receipt → early return, no re-spend (at-least-once idempotency); `generate` throws → `failed` + `error`.

### Success
- [x] `make check` passes
- [x] `make test` passes (extraction, mismatch, worker cases, golden test with new entry)
- [x] `SKIP_ENV_VALIDATION=1 pnpm run build` succeeds
- [x] User adds `ANTHROPIC_API_KEY` to `.env`; Inngest Dev Server running ([[inngest-local-dev-host-not-docker]])
- [ ] Upload a real receipt → row flips `pending` → `processed` with items; re-uploading the same file → `duplicate` (no second AI call); a corrupt file → `failed` with retry available — **2 of 3 verified in validation.** Dedup ✓: re-uploading the same JPG produced `status: duplicate`, `duplicateOfId: 9`, and **no AI call** (the hash short-circuit runs before the model). Corrupt file ✓ but one layer earlier than the plan describes: `prepReceipt` rejects it client-side, so no row is created at all and nothing reaches `failed`. `pending` → `processed` **not verified** — the Anthropic key has no credit ("Your credit balance is too low to access the Anthropic API"), so the extraction call can't run. Everything up to it was verified live: blob fetch, sha256, dedup branch, model invocation
- [x] `/security-review` (adds `ANTHROPIC_API_KEY`; worker fetches remote blob bytes + sends to Claude) — no findings; SSRF mitigated by `@vercel/blob` host allowlist

---

## Phase 4: Receipts page (history + detail + retry + delete)

### Changes
- `src/server/api/routers/receipts.ts` — add:
  - `list: protectedProcedure.query` — receipts leftJoin `user` (member name) + `transactions` (matched description), ordered `desc(createdAt)`, returning `receiptDate` as `YYYY-MM-DD` string; optional `status` filter input (the processed-but-unmatched "to-do queue").
  - `get: protectedProcedure.input({ id }).query` — one receipt + its `receiptItems` (+ joined expense/category names), 404 via `assertRow`-style guard.
  - `retry: protectedProcedure.input({ id }).mutation` — only when `status = failed`; `commitWithOutbox` sets `status: pending` + mints `receipt/retry` `{ receiptId }`.
  - `delete: protectedProcedure.input({ id }).mutation` — read the row for its `blobPathname`, delete the receipt (cascade removes `receiptItems`; matched transaction unlinks itself as the row disappears), then best-effort `del(blobPathname)` from `@vercel/blob` (a leftover blob is harmless; a dangling row is not).
- `src/domain/receipts/receipt.interface.ts` — add `ReceiptListItem` / `ReceiptDetail` shapes for the joined outputs.
- `src/app/(dashboard)/receipts/page.tsx` — RSC prefetch (`api.receipt.list.prefetch`) + `HydrateClient` (mirror `src/app/(dashboard)/transactions/page.tsx:1-18`).
- `src/app/_components/receipts/receipts-view.tsx` — history table: thumbnail, vendor, total, date, member, status badge; retry button on `failed`; `duplicate` rows link to `duplicateOfId` (no retry); Destructive delete (confirm dialog) on any row; status filter. Embeds `<ReceiptUpload />` from Phase 2. Uses `useSuspenseQuery`/`useMutation` + `utils.receipt.invalidate()` per `transactions-view.tsx`.
- `src/app/_components/receipts/receipt-detail.tsx` — image beside extracted items; items-total mismatch badge via `itemsTotalMismatch`. (Match banner + per-item pickers land in Phase 5.)
- `src/app/api/receipts/[id]/image/route.ts` — **added in impl** (not foreseen when the plan was written): the Blob store is private ([[vercel-blob-store-is-private]]), so `receipt-detail.tsx`/thumbnails can't `<img src={blobUrl}>` (anonymous GET 400s). Auth-gated GET route: session check → load `blobUrl` → `get(blobUrl,{access:'private'})` → stream bytes under the original content type, `Cache-Control: private, no-store`.
- `src/app/_components/app-nav.tsx` — add top-level `{ href: "/receipts", label: "Receipts", icon: ScanLine }` to `links` (`:25-42`); `Receipt` icon is taken by Transactions.

### Changes — tests
- `src/server/api/routers/receipts.mutations.test.ts` — `retry` refuses non-`failed` and mints `receipt/retry` for `failed`; `delete` removes row + calls blob `del` with the stored pathname (injected fake).

### Success
- [x] `make check` passes
- [x] `make test` passes
- [x] `/receipts` lists uploads with correct status badges; filter shows only the processed-but-unmatched queue — verified live against seeded rows in all five states; Retry appears only on `failed`, duplicates show a `Duplicate of #N` link. The to-do queue is now its own control: `status` is plain lifecycle equality and a separate "Unmatched only" filter ANDs `transactionId is null`. Folding the two together (the original shape) made a matched receipt unreachable through every status value — fixed and verified live: a matched receipt still lists under "Processed" and disappears under "Unmatched only"
- [x] Retry on a `failed` row re-runs the worker; delete removes the row + blob and unlinks any matched transaction — Retry minted `receipt/retry {receiptId: 6}` and re-ran the worker. Delete first returned 409 `CONFLICT` "Delete the duplicate copies of this receipt first."; after clearing the copies it removed the row, cascade-deleted its 5 items, freed the transaction (another receipt could then claim it, 200), and really removed the blob (every image route 404s — an initial 200 was a stale CDN read, confirmed with a cache-buster)
- [x] `/design-review` (new page + nav) — ran in validation against seeded fixtures in all five states; no blockers. One HIGH **fixed**: at 375px the items table's grid-item wrapper had no `min-w-0`, so the `w-52` picker column inflated the track, `overflow-x-auto` never engaged, and the per-item pickers were clipped off-screen with no way to reach them — attribution was unusable on a phone. Added `min-w-0` (same fix the matched banner already carried); re-measured at 375px: dialog no longer overflows (343px scroll = client), the table now scrolls, picker fully reachable. One HIGH **fixed globally**: `bg-positive/10 text-positive` measured 4.05:1 in light mode (AA needs 4.5:1) on the "Processed" badge and the matched strip, and the same `bg-X/10 text-X` shape failed for spend in dark (3.77:1). Rather than darken the money tokens (which would restyle every number in the app), added opaque `--badge-positive-*` / `--badge-spend-*` triplets in the existing `--badge-warn-*`/`--badge-info-*` idiom and moved the 9 tinted-surface call sites onto them; `text-positive`/`text-spend` stay for numbers, dots and borders. Re-measured in-browser: Processed 7.10:1 light / 9.40:1 dark, Failed 6.89:1 / 8.18:1. Mediums logged in the validation report (touch-reachability of Retry/Delete at 768px, `$185.68AUD` read as one token, identical `Delete receipt` labels on duplicate rows)
- [x] `/security-review` (delete removes a blob; `del` uses the same write token; private-blob image proxy route added — auth-gated) — HIGH stored-XSS **fixed; re-review confirms closed**: DTO `blobPathname` now rejects URL-shaped / `..` values (+ reject test), the image proxy allowlists `Content-Type` to `image/jpeg|image/png|application/pdf` (else `application/octet-stream`) and sets `X-Content-Type-Options: nosniff`, and the worker's second sink reads the blob by store-pinned `blobPathname` not the member-supplied `blobUrl`. No new findings; cross-member read/delete is the intended shared-workspace model (consistent app-wide), not an IDOR

---

## Phase 5: Read-time matching + per-item attribution

### Changes
- `src/domain/receipts/match.ts` — pure `matchCandidates({ total, receiptDate }, transactions): Ranked[]`: excludes already-receipt-linked rows, keeps `amount within ±2%` (exact counts) **and** `date within ±4 days`, ranks by amount-closeness then date-closeness (design decision 7 / matching §).
- `src/domain/receipts/match.test.ts` — **written first**, table-driven: tolerance boundaries (±2% inclusive, just-outside excluded), date window (±4d inclusive), already-linked exclusion, ranking order, empty result.
- `src/server/api/routers/receipts.ts` — add:
  - `matchCandidates: protectedProcedure.input({ receiptId }).query` — loads the receipt, fetches candidate `transactions` in a generous date window leftJoined to `receipts` (to expose the linked/unlinked flag), passes rows to the pure `matchCandidates`, returns the ranked list. Mirrors the window-query + read shape of `transaction.ts:235-258` / `:98-119`.
  - `confirmMatch: protectedProcedure.input({ receiptId, transactionId }).mutation` — update `receipts.transactionId`; on `23505` (the unique index) rethrow `CONFLICT "That transaction already has a receipt."` via `isPgError` (per `transaction.ts:47-52`); update-or-404 shape.
  - `setItemExpense` / `setItemCategory: protectedProcedure.input({ itemId, expenseId|expenseCategoryId }).mutation` — update the `receiptItems` row; `23503` → `CONFLICT` (FK gone), per the transaction router.
- `src/app/_components/receipts/receipt-detail.tsx` — match-suggestion banner (ranked, one-click `confirmMatch`); after `transactionId` is set, render per-item Expense + Category pickers (list-driven, never invent a category — glossary) wired to `setItemExpense`/`setItemCategory`.

### Changes — tests
- `src/server/api/routers/receipts.match.test.ts` — `confirmMatch` maps a `23505` to `CONFLICT`; `setItem*` maps a `23503` to `CONFLICT`.

### Success
- [x] `make check` passes
- [x] `make test` passes (pure match table + router conflict-mapping tests) — 32 files / 297 tests
- [x] Detail banner suggests the right transaction; confirming links it and removes it from other receipts' candidate lists (read-time freshness) — seeded two same-vendor transactions; banner ranked the exact-amount/same-day one first, confirming linked it, and the second receipt's banner then offered only the remaining transaction
- [x] A second receipt cannot confirm the same transaction (CONFLICT), proving the dup-photo catcher — forced `confirmMatch` on the taken transaction returned 409 `CONFLICT` "That transaction already has a receipt.". **Required a fix**: drizzle 0.45 wraps driver errors in `DrizzleQueryError` and hangs the `PostgresError` off `cause`, so the top-level-only `isPgError` never matched and this 500'd; `src/server/api/lib/pg-error.ts` now walks the `cause` chain (+ `pg-error.test.ts`). Same bug silently broke the transaction router's 23503 mapping
- [x] Per-item Expense/Category pickers persist and survive reload
- [x] `/design-review` (banner + per-item pickers) — no blockers. Two HIGH fixed: the matched banner overflowed the dialog by 32px at 375px (the `flex flex-col gap-5` wrapper is a grid item, so `min-width:auto` sized it to min-content — now `min-w-0`, banner wraps to two lines inside the dialog), and the suggestion button had no focus ring (now the app's `focus-visible:ring-3 ring-ring/50`). Also added a per-candidate pending spinner, named the `SUB_CENT` threshold, and gave the button a comma-separated `aria-label` so screen readers don't announce "bullet". Two MEDIUMs measured and **dismissed**: banner contrast is 5.74:1 in dark (above AA; the suggested `bg-positive/15` would have *lowered* it to 5.31), and Escape closes only the open picker, leaving the dialog up with focus back on the trigger. Light-theme `text-positive` on `bg-positive/10` measures 4.05:1 — a real AA miss, but it's the app-wide token pattern (`auth-form.tsx`, `app-nav.tsx`, `receipts-view.tsx` badges), not Phase 5; logged as a follow-up rather than fixed here

---

## Validation (whole branch)

- `/validate` runs `/code-review` across the branch once the phases land (standing step — not per-phase).
- Follow-up (not a code phase): run ~10 real household receipts through the worker before trusting category prefill (design testing §).

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` (Receipt pipeline §91-101; carries `## Related ADRs`)
- Prior plan: `thoughts/plans/2026-09-01-expense-linking-stage-4.md` (rails this builds on); local dev `thoughts/plans/2026-09-03-inngest-local-dev-server.md`
- ADRs (all **Accepted**): `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` (per-item granularity via receipt line items — implemented by Phases 1 & 5); `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` + `docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md` (outbox rails — consumed by Phases 2, 3, 4); `docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md` (plain-router style — governs every phase); `docs/adr/adr005-per-domain-drizzle-schema-files.md` (schema homes — Phase 1)
- Rails: `src/server/outbox/index.ts:8-11`, `src/server/inngest/events.ts:9-36`, `src/server/inngest/functions.ts:12-15`, `src/server/outbox/outbox.workers.ts:36-100`, `src/app/api/inngest/route.ts:12`
- Patterns to mirror: `src/server/transactions/transactions.schema.ts:6-45`, `src/domain/expenses/expense.dto.ts:6-18` + `.dto.test.ts:1-10`, `src/server/api/routers/transaction.ts:47-119,235-280`, `src/app/(dashboard)/transactions/page.tsx:1-18`, `src/app/_components/app-nav.tsx:25-42`, `src/lib/constants.ts:10-44`
- Libraries: `@vercel/blob` `handleUpload`/`upload`/`del` (env `BLOB_READ_WRITE_TOKEN`); AI SDK v5 `generateObject` → `result.object` with `@ai-sdk/anthropic` `anthropic("claude-sonnet-4-6")`, image `{ type:"image", image }` / PDF `{ type:"file", data, mediaType }` parts (env `ANTHROPIC_API_KEY`)
