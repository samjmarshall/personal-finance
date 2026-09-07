# Expense Linking Stage 6 — Email Ingestion Implementation Plan

## Context

Stage 5 shipped the receipt pipeline for the **upload** Channel: a member picks a file, `receipt.create` writes a `pending` row + a `receipt/uploaded` event, and the `process-receipt` worker extracts vendor/total/date + line items with Claude Vision (`src/server/api/routers/receipts.ts:62-82`, `src/server/receipts/receipts.workers.ts:67-226`). Stage 6 lights up the **email** Channel (design build-order item 6, `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md:146`): a member forwards a receipt from their personal address to one Resend inbound address, a strict sender allowlist decides whether it is ingested at all, and the same worker extracts it. Along the way this plan gives the app its first **Settings page**, which becomes the home for both the new allowlist and the previously-unmanageable `fortnightAnchor`.

## Current State

- **The email half of the pipeline is stubbed, not built.** `ReceiptChannel.Email` exists (`src/lib/constants.ts:34-37`) and `receipt.channel` already defaults to `upload` with `email` in the pgEnum (`src/server/receipts/receipts.schema.ts:28`), so **no `receipt` migration is needed** — exactly as stage 5 promised (`thoughts/plans/2026-09-04-expense-linking-stage-5.md:26`).
- **The event name is already frozen and golden-pinned.** `receipt/email.received` is in `EVENT_REGISTRY` with payload `{ receiptId: z.number().int() }` (`src/server/inngest/events.ts:11`) and in the event-name golden block (`src/server/inngest/registry-golden.test.ts:16-20`). Only the **worker-golden** block (`:44-51`) changes, because the `process-receipt` worker triggers on just `receipt/uploaded` + `receipt/retry` today (`src/server/receipts/receipts.workers.ts:219`).
- **The write door is ready.** `commitWithOutbox<T>(writes, events: (result: T) => OutboxEventDescriptor[])` commits canonical rows + outbox rows in one `db.transaction()` then best-effort sends (`src/server/outbox/commit.ts:32-60`). The events arg is a **function of the writes' result**, precisely so an event can carry a DB-generated id (`:19-24`) — which is what a multi-attachment email needs.
- **`receipt` columns constrain the email path.** `blobUrl` and `blobPathname` are both `notNull` (`src/server/receipts/receipts.schema.ts:32-33`), so an HTML e-receipt with no attachment must **also** be stored as a blob. `userId` is nullable `set null` (`:31`), `contentType` nullable (`:34`).
- **No server-side blob write exists.** `@vercel/blob` is used only for `get` (`src/server/receipts/receipts.workers.ts:3,232`; `src/app/api/receipts/[id]/image/route.ts:1,44`) and `del` (`src/server/api/routers/receipts.ts:2,211`). Writes go through the **client** `upload()` (`src/app/_components/receipts/receipt-upload.tsx:3,61-65`) with `addRandomSuffix: true` and no directory prefix. Stage 6 introduces the first server `put()`.
- **The worker can't read HTML.** `generate` picks a file part when `isPdf(mediaType)` and an **image part otherwise** (`src/server/receipts/receipts.workers.ts:191-203`); `isPdf` is exact equality on `"application/pdf"` (`src/lib/utils.ts:132-134`). A `text/html` blob would be sent as an image. The image proxy likewise allowlists `image/jpeg|image/png|application/pdf` and downgrades anything else to `application/octet-stream` under `nosniff` (`src/app/api/receipts/[id]/image/route.ts:13-17,48-56`), so an HTML receipt renders as a broken thumbnail today (`src/app/_components/receipts/receipts-view.tsx:161-173`).
- **`fortnightAnchor` is read-only and unmanageable.** `settingRouter` has one query and **no mutation anywhere in the codebase** (`src/server/api/routers/setting.ts:15-23`); `app_setting` is `key text PK` / `value text notNull` (`src/server/settings/settings.schema.ts`), seeded once by SQL (`drizzle/0002_expense_linking_stage_1.sql:41-42`, value `'2026-08-12'`). The key string is a **file-private const duplicated twice** (`src/server/api/routers/setting.ts:6`, `src/server/api/routers/cashflow.ts:15`). The value is a bare `YYYY-MM-DD` parsed by `fromDateInput` (`src/lib/utils.ts:69-82`); `null` degrades the cashflow grid to month (`src/domain/cashflow/cashflow.ts:140-141`) and the Unplanned picker to month-only (`src/app/_components/expenses/unplanned-view.tsx:51-53`), never throws.
- **There is no Settings/account page at all** and no way to list members. Routes today: Overview, expenses (planned/unplanned/categories), income, transactions, receipts. Nav `links` at `src/app/_components/app-nav.tsx:30-44`. `user.email` is `notNull().unique()` and always real (`src/server/auth/auth.schema.ts:9`).
- **UI conventions are `useState`, not react-hook-form.** The smallest write-a-value form is `src/app/_components/dashboard/balance-snapshot-card.tsx:17-99` (mutation + `onSuccess` invalidate + `disabled={isPending}` + `"Saving…"` + `role="alert"`); list+add+delete is `src/app/_components/expenses/categories-view.tsx:22-160` with `DeleteConfirmDialog` (`:153-160`); dates are native `<Input type="date">` via `toDateInput`/`fromDateInput` (`src/app/_components/income/income-form.tsx:58-59,195-200`).
- **Router tests are pure units** — `vi.mock` the db/auth/outbox/blob modules, drive `createCallerFactory(router)({db, session, headers})`, hand-roll chainable fakes (`src/server/api/routers/receipts.mutations.test.ts:1-38`). No test hits a live DB.
- **Not installed:** `resend`, `svix`. Next is **16.3.0**; route-handler docs live at `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `.../03-file-conventions/route.md`.

### Library reality that overrides the design

The design assumed the inbound webhook carries the attachments (`:95` "each attachment (PDF/JPG/PNG) stored to Blob"). **It does not.** Resend's `email.received` webhook is **metadata only** — `from`, `to`, `subject`, and an `attachments[]` of `{ id, filename, content_type, content_disposition, content_id }`. There is no body and no attachment bytes. Both are fetched afterwards against the Resend API:

- body → `resend.emails.receiving.get(email_id)` → `{ text, html, headers }`
- attachments → `resend.emails.receiving.attachments.list({ emailId })` → per-attachment `download_url` (**expiring**), then a plain `fetch`

Verification is Svix-based, exposed as `resend.webhooks.verify({ payload, headers, secret })` over the **raw** body (`svix-id` / `svix-timestamp` / `svix-signature`). Consequences carried into the plan: the fetch happens **promptly inside the webhook** (the download URLs expire, and the frozen `{ receiptId }` payload means a row must already exist when the event fires), and the metadata's `content_disposition`/`content_id` become the filter that keeps email-signature logos from becoming receipts.

## Desired End State

A member opens **`/settings`**, sets the household pay-cycle anchor (re-gridding the cash-flow chart), and adds the personal address they forward receipts from. They forward an Uber e-receipt and a PDF invoice to the inbound address. Each arrives as a `pending` Receipt attributed to them with `channel: email`, and the existing `process-receipt` worker extracts vendor/total/date + line items for both the PDF attachment and the HTML body. Mail from an address that is not on the allowlist is logged and dropped — no row, no blob, no Claude spend. `make check` and `make test` pass.

## Out of Scope

- **CDR (Redbark) / PayPal sync** — stage 7; they ride the same rails as new `provenance` values (design `:147`).
- **Quarantining unknown senders** — explicitly rejected (design decision 8, `:29`): a spam-review chore for a ~2-entry allowlist. Unknown senders are dropped and logged.
- **Auto-linking a receipt to a transaction** — design decision 7; a human always confirms. Stage 5's read-time matching is untouched.
- **Outbound email.** `resend` is added to *receive*; nothing in the app sends mail.
- **Turning `app_setting` into a client-writable key/value store.** A single named `setFortnightAnchor` mutation, not a generic `set(key, value)` — the vocabulary stays managed.
- Any `receipt`/`receipt_item` schema change, backfill of existing receipts, retention/expiry, household scoping (`householdId`), and a settings surface for anything beyond the anchor + the allowlist.
- Re-litigating adr003's driver swap or adr004's 3-tier architecture (adr012 governs: plain routers).

## Approach

Four vertical slices, each shipping alone. **Phase 1** creates the Settings page and makes `fortnightAnchor` writable — independently useful, and the shell the allowlist plugs into. **Phase 2** adds the `allowed_sender` table, its router, and its Settings panel (the only new migration in the stage). **Phase 3** is the pipeline: the Svix-verified webhook, an injected-deps ingestion core that fetches → blobs → writes rows + events through `commitWithOutbox`, and the `receipt/email.received` trigger on the existing worker — after which forwarded **attachments** extract end to end. **Phase 4** teaches the worker to read an **HTML** e-receipt (a text part instead of an image part) and stops the UI rendering a broken thumbnail for one. Pure logic (address parsing, attachment filtering, extraction-content selection) is table-tested; every I/O dependency is injected so `make test` stays offline, per the design's testing section (`:132-137`) and the stage-4/5 `makeRun*(deps)` convention.

Terminology follows `CONTEXT.md`: **Member**, **Receipt**, **Channel** (`upload | email`), **allowed sender**.

---

## Phase 1: Settings page + writable `fortnightAnchor`

Gives the app a Settings page and closes the gap where the pay-cycle anchor could only be changed by hand-writing SQL. No migration — `app_setting` already exists and is seeded.

### Changes

- `src/server/settings/settings.schema.ts` — export `FORTNIGHT_ANCHOR_KEY = "fortnightAnchor"` so the string has one home; it is currently a private const duplicated at `src/server/api/routers/setting.ts:6` and `src/server/api/routers/cashflow.ts:15`.
- `src/server/api/routers/setting.ts` — import the shared key (drop the local const) and add `setFortnightAnchor: protectedProcedure.input(fortnightAnchorSetDto).mutation`: upsert via `ctx.db.insert(appSettings).values({ key: FORTNIGHT_ANCHOR_KEY, value: input.value }).onConflictDoUpdate({ target: appSettings.key, set: { value: input.value } }).returning()`, then `assertRow(row, "set fortnight anchor")` (`src/server/api/lib/assert-row.ts:6-15`); return `row.value` as a **string**, matching the query's deliberate string-over-the-wire contract (`setting.ts:9-14`).
- `src/server/api/routers/cashflow.ts` — import the shared key, delete the duplicate const (`:15`).
- `src/domain/settings/setting.dto.ts` — **new**: `fortnightAnchorSetDto = z.object({ value: z.string().refine((v) => fromDateInput(v) !== null, "Enter a valid date") })`. Reusing `fromDateInput` (`src/lib/utils.ts:69-82`) keeps the DTO's notion of a valid calendar date identical to the reader's, so a value that parses here can never read back as `null`.
- `src/domain/settings/index.ts` — **new** barrel (mirror `src/domain/balances/index.ts`).
- `src/app/(dashboard)/settings/page.tsx` — **new** RSC: `void api.setting.fortnightAnchor.prefetch()` + `HydrateClient` + `<SettingsView />` (mirror `src/app/(dashboard)/receipts/page.tsx:1-11`).
- `src/app/_components/settings/settings-view.tsx` — **new**: `PageHeader` ("Settings") + the cards.
- `src/app/_components/settings/pay-cycle-card.tsx` — **new**, mirroring `balance-snapshot-card.tsx:17-99`: `useState` seeded from the query via `toDateInput`, native `<Input type="date">`, `api.setting.setFortnightAnchor.useMutation` whose `onSuccess` invalidates **both** `setting.fortnightAnchor` and `cashflow.get` (the anchor re-grids the chart — same pairing the balance card uses at `:20-23`), `disabled={isPending}` + `"Saving…"`, `role="alert"` error. Copy states plainly that this is the payday the fortnight buckets are counted from.
- `src/app/_components/app-nav.tsx` — append `{ href: "/settings", label: "Settings", icon: Settings }` to `links` (`:30-44`).

### Changes — tests

- `src/domain/settings/setting.dto.test.ts` — **written first** (TDD), mirroring `src/domain/categories/category.dto.test.ts`: accepts `"2026-08-12"`; rejects `""`, non-date text, a rolled-over date (`"2026-13-01"`, `"2026-02-30"`) and a 2-digit year — the cases `fromDateInput` rejects.
- `src/server/api/routers/setting.test.ts` — per the `vi.mock` + `createCallerFactory` pattern (`receipts.mutations.test.ts:1-38`) with a hand-rolled `insert().values().onConflictDoUpdate().returning()` fake: the upsert targets `appSettings.key` with `FORTNIGHT_ANCHOR_KEY`, writes the input value, and returns it; an empty `.returning()` raises the `assertRow` `INTERNAL_SERVER_ERROR`.

### Success

- [x] `make check` passes
- [x] `make test` passes (DTO cases + upsert unit)
- [x] `FORTNIGHT_ANCHOR_KEY` is declared once and imported by both `setting.ts` and `cashflow.ts`
- [x] `/settings` saves a new anchor, and the cash-flow chart's fortnight buckets shift to the new grid after invalidation
- [x] A malformed value is rejected by the form rather than written (a written-then-unreadable value would silently degrade the chart to the month grid)
- [x] `/design-review` (new page + nav entry)

> Implementation note. Deviation: the pay-cycle section seeds its input straight from
> the query string rather than through `toDateInput` as the plan specified — the query
> already returns `YYYY-MM-DD`, and re-parsing it to a `Date` reads UTC midnight, which
> walks behind-UTC members back a day (verified: `TZ=America/New_York` turns
> `"2026-08-12"` into `2026-08-11`).
>
> The reject path was verified in-browser: submitting an empty anchor renders
> `role="alert"` "Please enter a valid date.", sets `aria-invalid`, and issues **zero**
> network calls — nothing reaches the db.
>
> The remaining unchecked item is the only one that writes. Left for the user rather
> than mutating household data unprompted.
>
> `/design-review` also moved the theme control off the sidebar rail onto this page
> (rail + preview tiles), and caught two defects, both fixed: the System tile rendered
> the light palette permanently for device-dark members (hydration attribute mismatch
> — React keeps the server's attribute and `resolvedTheme` never changes again, so it
> never repaints; now gated on `mounted`), and the section rail fell back to the
> browser's default focus ring while the tiles carried the project's.

> Validation note (`/validate`). The last box is now ticked — verified in-browser:
> anchor `2026-08-12` → `2026-08-15` shifted **every** fortnight tick by exactly three
> days (`10 Mar → 13 Mar`, `7 Apr → 10 Apr`, … `9 Feb → 12 Feb`); the original value
> was restored and the grid returned to baseline. The reject path was re-confirmed
> (empty anchor → `role="alert"`, `aria-invalid`, `aria-describedby`, zero tRPC calls).
>
> Carried into Phase 2 rather than fixed here (see the `/validate` report):
> `FORTNIGHT_ANCHOR_KEY` is a non-table export in a `*.schema.ts`, so `src/server/db/index.ts`
> spreads it into the object handed to `drizzle()`; the DTO checks calendar validity
> but not the padded `YYYY-MM-DD` shape `<input type="date">` needs; and the inline
> `role="alert"` double-reports mutation failures alongside the global `MutationCache`
> toast while wrongly setting `aria-invalid` on a valid date.

---

## Phase 2: `allowed_sender` table, router, and Settings panel

The allowlist the webhook will consult, plus the only way to populate it. Members self-register the addresses they forward from — consistent with the shared-workspace model stage 5 confirmed, and unavoidable because user ids are runtime values that a seed migration cannot know.

### Changes

- `src/server/receipts/allowed-sender.schema.ts` — **new** (co-located under the receipts domain the way `categories.schema.ts` sits under expenses; adr005, glob-discovered). Table `allowed_sender`: `id` integer identity PK; `email text notNull` stored lower-cased; `userId text notNull references(() => user.id, { onDelete: "cascade" })` — unlike a Receipt, an allowlist entry is pure config and is meaningless once its Member is gone; `createdAt` timestamp `$defaultFn` notNull. Extras: `unique("allowed_sender_email_unique").on(t.email)` (one address maps to exactly one Member, so inbound attribution is unambiguous) and `index("allowed_sender_user_idx").on(t.userId)`.
- `src/server/db/index.ts` — import + spread-merge the new module into the schema object (mirror the receipts import lines).
- `src/domain/receipts/allowed-sender.dto.ts` — **new**: `allowedSenderCreateDto = z.object({ email: z.email().transform((v) => v.trim().toLowerCase()) })` — normalising here means the stored value, the unique index, and the webhook's lookup key are all the same shape. Plus `allowedSenderRefDto = z.object({ id: z.number().int() })`.
- `src/domain/receipts/allowed-sender.interface.ts` — **new**: `AllowedSender`, and `AllowedSenderListItem` (adds `userName: string | null`).
- `src/domain/receipts/index.ts` — re-export both, alphabetised per the existing barrel (`:19-37`).
- `src/server/api/routers/allowed-sender.ts` — **new** plain router (adr012): `list` (leftJoin `user` for the Member name, ordered by email); `add` (values `{ email: input.email, userId: ctx.session.user.id }`, `.returning()` + `assertRow`; a `23505` becomes `CONFLICT "That address is already on the allowlist."` via `isPgError`, per `src/server/api/routers/receipts.ts:287-292`); `remove` (delete by id, `NOT_FOUND` when nothing matched).
- `src/server/api/root.ts` — register `allowedSender: allowedSenderRouter` in the router object (`:16-25`).
- `src/app/_components/settings/allowed-senders-card.tsx` — **new**: list of address + owning Member, an inline add field, and a remove button behind `DeleteConfirmDialog`, mirroring `categories-view.tsx:22-160`. Copy states the rule the webhook enforces: only these addresses are ingested, everything else is dropped.
- `src/app/_components/settings/settings-view.tsx` — render the card.
- `src/app/(dashboard)/settings/page.tsx` — add `void api.allowedSender.list.prefetch()`.
- `drizzle/0010_*.sql` — generated by `make db_generate` (next number after `0009`); do not hand-write.

### Changes — tests

- `src/domain/receipts/allowed-sender.dto.test.ts` — **written first**: accepts and **lower-cases/trims** a mixed-case address; rejects empty and non-email input; compile-time `Expect<WritesInto<z.infer<typeof allowedSenderCreateDto> & { userId: string }, AllowedSender>>` per `src/domain/expenses/expense.dto.test.ts:1-10`.
- `src/server/receipts/allowed-sender.schema.test.ts` — `getTableColumns` assertions (notNull/hasDefault/nullable), mirroring `src/server/receipts/receipts.schema.test.ts`.
- `src/server/api/routers/allowed-sender.test.ts` — `add` persists the normalised address with the **session** user id (never a client-supplied one) and maps `23505` → `CONFLICT`; `remove` 404s when no row matched.

### Success

- [ ] `make check` passes (`db:check` sees no drift after generate)
- [ ] `make test` passes
- [ ] `make db_generate` produces one additive migration — a single `CREATE TABLE "allowed_sender"` plus its unique + index, with **no change to `receipt`**
- [ ] **User runs** `make db_migrate` against the feature-branch DB (never `main`/prod)
- [ ] Adding an address on `/settings` lists it against the adding Member; re-adding it (any casing) is refused with the CONFLICT message, not a 500
- [ ] `/design-review` (new panel)

---

## Phase 3: Resend inbound webhook + email producer

The producer. Verify → allowlist → fetch → blob → rows + events, then the existing worker takes over. After this phase a forwarded **attachment** extracts end to end; a forwarded HTML-only e-receipt is stored and rides through as a Receipt the worker cannot yet read well (Phase 4 closes that).

> **Library note (verify at implementation time):** confirm the pinned `resend` exposes `webhooks.verify`, `emails.receiving.get` and `emails.receiving.attachments.list`; if the pinned version lacks the verify helper, add `svix` and use `new Webhook(secret).verify(rawBody, headers)` — the signature scheme is identical. Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before writing the route (Next 16.3.0).

### Changes

- `package.json` — add `resend` via `pnpm add`.
- `src/env.js` — add to the `server` block (`:13-66`) and mirror each in `runtimeEnv` (`:81-94`): `RESEND_API_KEY: requiredInProd(z.string())`, `RESEND_WEBHOOK_SECRET: requiredInProd(z.string())`, and `RESEND_INBOUND_ADDRESS: z.string().optional()` (display-only — the address members forward to).
- `.env.example` — add the three keys.
- `src/server/receipts/email-ingest.ts` — **new**. Pure helpers first:
  - `parseFromAddress(from: string): string` — takes the `<addr>` when the header is `Name <addr>`, else the trimmed value; lower-cased so it matches the stored allowlist shape.
  - `isReceiptAttachment(a): boolean` — `content_type` ∈ `image/jpeg | image/png | application/pdf` **and** not inline (`content_disposition !== "inline"` and no `content_id`). Inline parts are the sender's email-signature and vendor logos; without this filter every branded e-receipt would mint junk Receipts.
  - `emailBlobPathname(contentType): string` — `receipts/email/<uuid>.<ext>`. Server-generated, store-relative, so both existing read sinks (`get` by `blobPathname` in the worker `:231-238` and the image proxy `:44`) stay pinned to our own store.
  - `makeRunIngestInboundEmail({ db, commitWithOutbox, put, getEmail, listAttachments, fetchBytes })` → `runIngestInboundEmail(event)`:
    1. Look the parsed sender up in `allowedSenders`. **Miss → `console.info` and return `{ status: "dropped" }`** before any fetch, blob write or model call (design decision 8, `:29`).
    2. `qualifying = event.data.attachments.filter(isReceiptAttachment)`.
    3. If `qualifying.length` → `listAttachments(emailId)`, join to the qualifying ids, `fetchBytes(download_url)` and `put(pathname, bytes, { access: "private", contentType, addRandomSuffix: false })` for each. The uuid already makes the key unique, so the stored `blobPathname` is exactly what we generated.
    4. Else → `getEmail(emailId)`, prefer `html` over `text`, and `put` it under `text/html`/`text/plain`. Both blank → return `{ status: "empty" }` without writing a row (nothing to extract).
    5. `commitWithOutbox(tx => …insert one row per stored blob `.returning()`…, rows => rows.map(r => buildOutboxEvent("receipt/email.received", { receiptId: r.id })))`, each row `status: Pending`, `channel: ReceiptChannel.Email`, `userId` = the **allowlist entry's** Member. Blob writes happen before the transaction; a rolled-back commit leaves only an orphan blob, which is harmless (the same trade the delete path already makes, `receipts.ts:210-214`).
- `src/app/api/receipts/inbound/route.ts` — **new** `POST`: read the **raw** body with `await request.text()` (a parsed body cannot be signature-verified), `resend.webhooks.verify` with `RESEND_WEBHOOK_SECRET` → **401** when it fails, Zod-parse the event, ignore any `type` other than `email.received` with **200**, then call the core wired with the real `resend` client, `put`, and the `commitWithOutbox` singleton. Return **200** for both ingested and dropped (a drop is a verdict, never retry it) and let a genuine processing failure surface as **5xx** so Svix retries. `export const maxDuration = 60`.
- `src/server/receipts/receipts.workers.ts` — add `{ event: "receipt/email.received" }` to the `process-receipt` `triggers` (`:219`). The handler already reads `event.data.receiptId` (`:221-224`) and the payload matches.
- `src/server/inngest/registry-golden.test.ts` — append the new trigger to the pinned `process-receipt` entry (`:44-51`); the event-name block (`:16-20`) already contains `receipt/email.received` and stays untouched. Order is asserted exactly.
- `src/app/_components/settings/allowed-senders-card.tsx` + `src/app/(dashboard)/settings/page.tsx` — surface `RESEND_INBOUND_ADDRESS` (read server-side in the RSC, passed as a prop) so the panel says where to forward. Rendered only when configured.

### Changes — tests

- `src/server/receipts/email-ingest.test.ts` — **written first**, all deps faked (no network, no DB): table cases for `parseFromAddress` (`"Sam <A@B.com>"` → `a@b.com`, bare address, surrounding whitespace) and `isReceiptAttachment` (allowed type kept; `content_disposition: "inline"` dropped; `content_id` present dropped; `text/calendar` dropped). Core cases: unknown sender → `dropped`, with `put` and `commitWithOutbox` never called; allowed sender + one PDF → one row carrying `channel: email` and the **allowlist owner's** `userId`, and exactly one `receipt/email.received` event carrying the returned row id as a number; two qualifying attachments → two rows and two events; inline-logo-only → falls back to the HTML body; no attachments → body stored, `html` preferred over `text`; both bodies blank → no row, no event.

### Success

- [ ] `make check` passes
- [ ] `make test` passes (ingest core + helpers + updated worker golden)
- [ ] `SKIP_ENV_VALIDATION=1 pnpm run build` succeeds
- [ ] User adds `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (and optionally `RESEND_INBOUND_ADDRESS`) to `.env`; Resend inbound domain + webhook endpoint configured for `email.received`
- [ ] Forwarding an email with a JPG/PDF attachment from an allowed address creates a `pending` Receipt attributed to that Member with `channel: email`, which the worker flips to `processed` with items
- [ ] Forwarding from an address that is **not** on the allowlist creates no row and no blob, and is logged
- [ ] A request with a bad/absent signature is rejected 401 before the allowlist is consulted
- [ ] `/security-review` (new secrets in `src/env.js`; new public unauthenticated webhook doing raw-body signature verification; first server-side blob write; remote bytes fetched and persisted)
- [ ] `/design-review` (forwarding address on the Settings panel)

---

## Phase 4: HTML e-receipt extraction + non-image receipts in the UI

Most modern receipts are an HTML email, not an attachment. This teaches the worker to send one as text and stops the list rendering a broken image for it.

### Changes

- `src/lib/utils.ts` — add `isHtml(contentType)` beside `isPdf` (`:132-134`), matching `text/html` (and `text/plain`).
- `src/server/receipts/extraction.ts` — add pure `buildExtractionContent({ prompt, bytes, mediaType })` returning the AI-SDK message content array: PDF → text + `{ type: "file" }`; HTML/text → decode the bytes UTF-8 and fold them into a **single text part**; anything else → text + `{ type: "image" }` (today's behaviour). Extend `buildExtractionPrompt` (`:43-51`) with one line telling the model the payload may be a forwarded e-receipt email, so it reads past greetings and footers to the order lines.
- `src/server/receipts/receipts.workers.ts` — `generate` calls `buildExtractionContent` instead of its inline `isPdf` ternary (`:191-203`). The pure core is untouched: it already just hands `{ bytes, mediaType }` to the injected `generate`.
- `src/app/_components/receipts/receipts-view.tsx` — extend the thumbnail branch (`:161-173`) so `isHtml(contentType)` renders a `Mail` icon like the PDF case, rather than an `<img>` the proxy will only ever serve as `application/octet-stream` (`src/app/api/receipts/[id]/image/route.ts:48-56`).
- `src/app/_components/receipts/receipt-detail.tsx` — same guard in the image pane, with a short "arrived by email" note in place of the preview.

### Changes — tests

- `src/server/receipts/extraction.test.ts` — **written first**, table-driven over `buildExtractionContent`: `application/pdf` → a file part; `image/jpeg` → an image part; `text/html` → one text part whose body is the decoded markup and which carries **no** image part (the regression this phase exists to prevent).
- `src/server/receipts/receipts.workers.test.ts` — a `text/html` receipt reaches the injected `generate` with its html mediaType and still writes `processed` + items, proving the email path lands in the same terminal states as upload.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] Forwarding a real Uber/Amazon HTML e-receipt (no attachment) from an allowed address extracts vendor, total and line items
- [ ] An HTML receipt shows an icon in the list and detail rather than a broken image
- [ ] Attachment receipts (Phase 3) and uploads (stage 5) still extract unchanged
- [ ] `/security-review` (touches `src/lib/**`; untrusted third-party email markup becomes model input — confirm it is confined to a content part and that nothing renders the stored HTML)
- [ ] `/design-review` (thumbnail + detail states)

---

## Validation (whole branch)

- `/validate` runs `/code-review` across the branch once the phases land (standing step — not per-phase). Confirm: no `receipt`/`receipt_item` schema change; `allowed_sender` is the only new table; the allowlist is consulted before any fetch, blob write or model call; the webhook verifies the raw body and returns 200 for drops but 5xx for genuine failures; every event is minted through `buildOutboxEvent` and written via `commitWithOutbox` (never a bare `inngest.send`); `EVENT_REGISTRY` keys unchanged and the worker golden updated deliberately; plain-router style held (adr012).
- **Known limitation to record, not fix:** a Svix redelivery of the same `email.received` creates a second set of rows. The worker's `contentHash` dedup marks them `duplicate` without a second extraction (`receipts.workers.ts:98-114`), so the cost is a visible junk row, not spend or bad data. Adding a Resend `email_id` column to `receipt` is the fix if it ever becomes a nuisance — deliberately deferred to keep this stage migration-free on `receipt`.
- Follow-up (not a code phase): run a handful of real forwarded e-receipts through the worker before trusting HTML category prefill, alongside stage 5's outstanding ~10-receipt eval (design `:137`).

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — build order item 6 (`:146`), email path (`:95`), decision 8 sender allowlist (`:29`), `allowed_sender`/`app_setting` tables (`:58-59`), error handling (`:129`); carries `## Related ADRs` (`:149-154`)
- Prior plans: `thoughts/plans/2026-09-04-expense-linking-stage-5.md` (the pipeline this extends; stage-6 boundary at `:26`), `thoughts/plans/2026-09-01-expense-linking-stage-4.md` (outbox/Inngest rails), `thoughts/plans/2026-09-03-inngest-local-dev-server.md` (local worker runs)
- ADRs (all **Accepted**; no new ADR and no Proposed ADR to implement — the design's ADR appendix is fully resolved): `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` (outbox write door + at-least-once — consumed by Phase 3); `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` (per-item granularity via receipt line items — extended to the email Channel); `docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md` (plain-router style — governs every phase); `docs/adr/adr005-per-domain-drizzle-schema-files.md` (schema home — Phase 2)
- Rails and sinks: `src/server/outbox/commit.ts:32-60`, `src/server/inngest/events.ts:9-36`, `src/server/inngest/functions.ts:13-17`, `src/server/receipts/receipts.workers.ts:67-238`, `src/app/api/receipts/[id]/image/route.ts:13-61`
- Patterns to mirror: `src/app/_components/dashboard/balance-snapshot-card.tsx:17-99` (small form + mutation), `src/app/_components/expenses/categories-view.tsx:22-160` (list/add/delete + `DeleteConfirmDialog`), `src/app/(dashboard)/receipts/page.tsx:1-11` (RSC prefetch shell), `src/server/api/routers/receipts.ts:57-82,287-292` (producer + `23505` mapping), `src/server/api/routers/receipts.mutations.test.ts:1-38` (router unit-test fakes), `src/server/receipts/receipts.schema.ts:23-64` (table idioms), `src/app/_components/app-nav.tsx:30-44` (nav)
- Library docs: Resend inbound — `email.received` webhook is metadata-only; body via `emails.receiving.get`, attachment bytes via `emails.receiving.attachments.list` → expiring `download_url`; Svix verification through `resend.webhooks.verify` over the raw body. Next 16.3.0 route handlers — `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
