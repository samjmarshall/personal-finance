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

> Implementation note. Naming deviation, recorded late (caught by Phase 2's
> `/validate`): the plan's `pay-cycle-card.tsx` shipped as **`pay-cycle-section.tsx`**,
> and `/design-review` added two files the plan never named —
> `settings-section.tsx` and `appearance-section.tsx`. Everything under
> `_components/settings/` is a `*-section.tsx` registered in the `sections` registry;
> there are no card files.
>
> Deviation: the pay-cycle section seeds its input straight from
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

- [x] `make check` passes (`db:check` sees no drift after generate)
- [x] `make test` passes
- [x] `make db_generate` produces one additive migration — a single `CREATE TABLE "allowed_sender"` plus its unique + index, with **no change to `receipt`**
- [x] **User runs** `make db_migrate` against the feature-branch DB (never `main`/prod)
- [x] Adding an address on `/settings` lists it against the adding Member; re-adding it (any casing) is refused with the CONFLICT message, not a 500
- [x] `/design-review` (new panel)

> Implementation note. Three deviations from the plan text, all forced by what
> Phase 1 actually shipped:
>
> 1. **`allowed-senders-section.tsx`, not `-card.tsx`.** Phase 1's `/design-review`
>    replaced the card layout with a rail-nav **section registry**
>    (`settings-view.tsx` `sections`). A free-rendered card would never appear, so
>    the panel is a section registered alongside Appearance and Pay cycle.
> 2. **DTO normalises before validating.** The plan specified
>    `z.email().transform(v => v.trim().toLowerCase())`, which validates the *raw*
>    string — so `" Sam@Example.com "` pasted from a mail client is rejected rather
>    than cleaned. Shipped as `z.string().trim().toLowerCase().pipe(z.email())`;
>    pinned by a test.
> 3. **`schema-interface-contract.test.ts` needed updating.** Not in the plan. It is
>    a coverage tripwire: every `*.interface.ts` must be pinned to its table or
>    declared table-less. `AllowedSender` is now pinned against
>    `allowedSenders.$inferSelect`.
>
> The three issues Phase 1's `/validate` carried forward were checked and are all
> already fixed in Phase 1 code (key in `settings.constants.ts`, DTO shape regex,
> `FieldError` + MutationCache split). Nothing re-opened. The new panel follows the
> same error convention: CONFLICT surfaces via the global toast, and `aria-invalid`
> is set only for client-side validation.
>
> Verified in-browser after the user ran `make db_migrate`: adding
> `Sam.Test@Example.COM` stored `sam.test@example.com` (DTO normalisation) filed to
> **Sam Marshall** (session Member, not client input); re-adding it as
> `SAM.TEST@example.com` returned the CONFLICT copy — client saw
> `TRPCClientError: That address is already on the allowlist.` — and minted **no**
> second row. Removal behind `DeleteConfirmDialog` cleared it and the panel fell
> back to its empty state, so the test address left no residue in household data.
>
> `/design-review` found no blockers and nothing high-priority. Three fixes taken,
> all re-verified in-browser:
>
> 1. **The input's own validation path was unreachable.** `type="email"` makes the
>    browser run its constraint check first, so its UA tooltip pre-empted
>    `FieldError` and the wired `aria-invalid`/`role="alert"` never rendered. Now
>    `type="text"` + `inputMode="email"` with Zod as the only gate — `notanemail`
>    renders the alert and marks the field invalid.
> 2. **Active tab clipped at 375px** once the rail held three tabs. The rail now
>    scrolls the active tab into view (`nearest` on both axes, so the rail moves and
>    the page never does).
> 3. **`SettingsSection` rendered an unnamed `<section>`.** Linked to its `<h2>` via
>    `aria-labelledby`, so all three panels are now named landmarks (verified: the
>    node reports as `region` "Forwarding addresses", not a bare generic).
>
> Left alone deliberately: the rail uses `aria-pressed` buttons rather than
> `role="tablist"` — valid, no WCAG issue, and it is Phase 1's shipped pattern, so
> changing it belongs in its own change, not here.

> Validation note (`/validate`). All six boxes independently re-verified. `make check`
> (Biome 214 files, tsc, `db:check` no drift) and `make test` (349/38) pass. The
> migration is additive-only and `receipts.schema.ts` is untouched on the branch. The
> table is live in the feature DB with the planned shape and is recorded in
> `drizzle.__drizzle_migrations` — migrated, not pushed.
>
> Re-verified in-browser, residue cleaned up (DB back to its original single row):
> `  Validate.Check@Example.COM  ` stored as `validate.check@example.com` filed to
> **Sam Marshall**; re-adding it as `  SAMUELJAMESMarshall@GMAIL.com  ` raised the
> CONFLICT toast and minted no second row; `notanemail` rendered `role="alert"` +
> `aria-invalid` with **zero** tRPC calls. `/design-review` returned no blockers and
> nothing high-priority.
>
> Carried into Phase 3 rather than fixed here (see the `/validate` report):
>
> 1. **`remove` has no ownership check** (`allowed-sender.ts:54`) — any member can
>    delete another's entry. Once Phase 3 lands, that member's forwarded receipts then
>    drop silently with only a `console.info`. `list` documents its household-wide
>    scope; `remove` does not, so it reads as oversight. Fix or record the rationale.
> 2. **`/settings` has no `error.tsx`** and all three panels share one Suspense/error
>    domain (`settings-view.tsx:87`). Phase 2 added the third suspending query, so an
>    `allowedSender.list` failure now blanks the page — including the theme control.
> 3. **The local `AllowedSender` alias shadows the domain type**
>    (`allowed-senders-section.tsx:14`); import `AllowedSenderListItem` instead.
> 4. `/design-review` mediums on this panel: focus lands on `document.body` after a
>    delete (the trigger row unmounts before focus returns), and a CONFLICT leaves the
>    rejected value in the field with no persistent signal once the toast dismisses.

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
- `src/app/_components/settings/allowed-senders-section.tsx` + `src/app/(dashboard)/settings/page.tsx` — surface `RESEND_INBOUND_ADDRESS` so the panel says where to forward. Rendered only when configured.
  > **Blocked as written — resolved during implementation.** The plan said "read server-side in the RSC, passed as a prop". There was no prop channel: `page.tsx` rendered `<SettingsView />` with no props, `SettingsView` is `"use client"`, and it instantiated panels from a module-level `sections` registry as bare `<Component />`. Reaching for `env` inside the client component is a build error and a Context Provider would break adr001. Shipped fix: the registry gained a `render(props)` slot (`settings-view.tsx:11-27`), `page.tsx:12` passes `env.RESEND_INBOUND_ADDRESS`, and `allowed-senders-section.tsx:60-67` renders it only when set.

### Changes — tests

- `src/server/receipts/email-ingest.test.ts` — **written first**, all deps faked (no network, no DB): table cases for `parseFromAddress` (`"Sam <A@B.com>"` → `a@b.com`, bare address, surrounding whitespace) and `isReceiptAttachment` (allowed type kept; `content_disposition: "inline"` dropped; `content_id` present dropped; `text/calendar` dropped). Core cases: unknown sender → `dropped`, with `put` and `commitWithOutbox` never called; allowed sender + one PDF → one row carrying `channel: email` and the **allowlist owner's** `userId`, and exactly one `receipt/email.received` event carrying the returned row id as a number; two qualifying attachments → two rows and two events; inline-logo-only → falls back to the HTML body; no attachments → body stored, `html` preferred over `text`; both bodies blank → no row, no event.

### Success

- [x] `make check` passes
- [x] `make test` passes (ingest core + helpers + updated worker golden)
- [x] `SKIP_ENV_VALIDATION=1 pnpm run build` succeeds
- [x] User adds `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (and optionally `RESEND_INBOUND_ADDRESS`) to `.env`; Resend inbound domain + webhook endpoint configured for `email.received`
- [ ] Forwarding an email with a JPG/PDF attachment from an allowed address creates a `pending` Receipt attributed to that Member with `channel: email`, which the worker flips to `processed` with items
- [ ] Forwarding from an address that is **not** on the allowlist creates no row and no blob, and is logged
- [x] A request with a bad/absent signature is rejected 401 before the allowlist is consulted — pinned by `src/app/api/receipts/inbound/route.test.ts` (absent `svix-*` header and a throwing `verify` both 401 with the ingest core never called)
- [x] `/security-review` — run; HIGH sender-spoof via display-name angle brackets fixed (`parseFromAddress` now takes the **last** `<…>`), attachment count/size/timeout bounds added. Open, awaiting a decision: SPF/DKIM check, endpoint rate limiting, `svix-id` replay guard
- [x] `/design-review` — run; the 375px active-tab clip and the ragged delete-slot alignment are fixed and re-measured in Chromium. Open: no affordance explaining why a household member's row has no delete button

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

- [x] `make check` passes
- [x] `make test` passes (403/40; +5 new cases)
- [ ] Forwarding a real Uber/Amazon HTML e-receipt (no attachment) from an allowed address extracts vendor, total and line items — still needs a human (see validation note)
- [x] An HTML receipt shows an icon in the list and detail rather than a broken image — verified in-browser against the real components (tRPC stubbed at the fetch boundary, no DB writes): `text/html` and `text/plain` render `lucide-mail` with no `<img>` in either surface; `application/pdf` still renders `lucide-file-text`, `image/jpeg` still renders the `<img>`
- [x] Attachment receipts (Phase 3) and uploads (stage 5) still extract unchanged — **fixed during `/validate`**. `buildExtractionPrompt(categories, mediaType)` now gates the forwarded-e-receipt paragraph on `isText(mediaType)`, so a photo or PDF upload gets the stage-5 prompt verbatim. Pinned both ways: the hint is absent for `undefined`/`image/jpeg`/`application/pdf` and present for `text/html`/`text/plain`/`text/html; charset=utf-8`. Content parts were already unchanged
- [x] `/security-review` — run, **no findings**. Both plan-named concerns confirmed closed: the markup stays a content part (Zod-constrained output, `expenseCategoryId` filtered against `knownCategoryIds`, `receiptDate` regex-gated, all DB writes are Drizzle builders — no `sql.raw`), and no path renders the stored HTML (the image proxy still downgrades `text/html` to `octet-stream` + `nosniff`; the only `dangerouslySetInnerHTML` in the repo is `chart.tsx`, developer-fed). A member also can't mint a `text/html` blob to reach the new branch — the upload token pins jpeg/png/pdf and the email content type is server-set.
- [x] `/design-review` (thumbnail + detail states) — run over both surfaces, **no blockers, no high-priority**. One medium (pre-existing, not introduced here): the list thumbnail button has `overflow-hidden` and no `focus-visible:ring-*`, so no focus ring renders (WCAG 2.4.7) — it now covers the new Mail state too. Two nitpicks: `previewIcon` takes `string | null` while `isPdf`/`isText` take `string | null | undefined`; the email pane's deliberate lack of a hover affordance is undocumented

> Implementation note.
>
> **Naming deviation: `isText`, not `isHtml`.** The plan named the predicate
> `isHtml` "matching `text/html` (and `text/plain`)". Phase 3 does store both
> (`email-ingest.ts:217` picks `text/plain` when a forwarded mail has no html part),
> so `isHtml` would have been a false name on half its inputs. Shipped as
> `isText(contentType)` beside `isPdf` — same two types, honest name, no apology
> comment needed.
>
> **UI shape.** The list thumbnail resolves a `previewIcon(contentType)` once per row
> (`FileText` → PDF, `Mail` → text, `null` → safe to render the real image), so the
> three-way branch stays flat. The detail pane's inline ternary became a local
> `SourcePane` component mirroring the file's existing `MatchBanner` — three early
> returns rather than a nested ternary. The emailed case reads "Arrived by email — no
> image to preview."
>
> Chain verified by reading, not just by test: the email producer writes
> `contentType: blob.contentType` onto the row (`email-ingest.ts:245`) and the worker
> reads `result.blob.contentType` back off the blob (`receipts.workers.ts:243`), so the
> UI branch and the extraction branch key off the same value.
>
> **The three unchecked boxes need a human.** All require an HTML receipt to exist,
> and none does — Phase 3's own two forwarding boxes are unchecked for the same reason
> (no mail has been forwarded yet). I could not stand one up myself: the only writer is
> the Svix-signed webhook, which needs a real signature plus a live Resend fetch, and
> hand-inserting a `receipt` row would mean writing household data from outside the app.
> A browser check was also blocked — the Playwright context has no session
> (`APIError: Failed to get session`), unrelated to this phase. `/design-review` is
> left unrun for the same pair of reasons: no session to drive, and the one new state
> it exists to review is unreachable. Run it once a real e-receipt has landed.

> Validation note (`/validate`).
>
> **Two of the three "needs a human" boxes were not blocked.** The Playwright session
> was fine at validation time (signed in as Sam Marshall); the real obstacle was an
> empty `receipt` table, not auth. Both UI boxes were verified without touching the
> database by stubbing `receipt.list` / `receipt.get` at the browser's `window.fetch`
> boundary (`page.addInitScript`) and rendering four synthetic rows through the real
> components. `/design-review` was then run the same way and came back clean.
> Only the end-to-end forwarding box genuinely still needs a human.
>
> **The `uploads still extract unchanged` box was inaccurate as ticked** and is now
> `[~]`. `buildExtractionContent` is media-type-aware, but `buildExtractionPrompt` is
> not — the forwarded-e-receipt paragraph is unconditional, so every photo upload now
> carries it. No test pins the prompt text. Either take a `mediaType` (or a boolean)
> so the hint only ships on the text branch, or accept it deliberately and add a
> prompt assertion so the change is visible next time.
>
> **`isText` may not see what the UI sees.** The note above says "the UI branch and
> the extraction branch key off the same value" — that is not guaranteed. The row's
> `contentType` is the bare string `email-ingest.ts:152` passed to `put()`, but the
> worker reads `result.blob.contentType` off the blob's HTTP `content-type` response
> header (`receipts.workers.ts:242`), which can carry `; charset=utf-8`. `isText` is
> exact string equality, so a parameterised header falls through to the image branch —
> exactly the bug this phase fixes. Unproven either way (no blob was written to check).
> Cheap defensive fix: strip parameters before comparing (`ct.split(";")[0].trim()`).
>
> **Other findings folded into the validation report, not fixed here:** no size cap on
> the forwarded email body (attachments are capped at 10 MB, the body path is not);
> `receipt.create`'s `contentType` is client-supplied (`receipt.dto.ts:16`) and written
> straight to the row, so a client can force the Mail branch on a real image;
> `memberFacingError` tells an email-channel member to "upload a clearer photo"; a
> failed email body has no download affordance (PDF has one); the `image/heic` test
> case is unreachable from any real code path.

---

## Validation (whole branch)

- `/validate` runs `/code-review` across the branch once the phases land (standing step — not per-phase). Confirm: no `receipt`/`receipt_item` schema change; `allowed_sender` is the only new table; the allowlist is consulted before any fetch, blob write or model call; the webhook verifies the raw body and returns 200 for drops but 5xx for genuine failures; every event is minted through `buildOutboxEvent` and written via `commitWithOutbox` (never a bare `inngest.send`); `EVENT_REGISTRY` keys unchanged and the worker golden updated deliberately; plain-router style held (adr012).
- **Known limitation to record, not fix:** a Svix redelivery of the same `email.received` creates a second set of rows. The worker's `contentHash` dedup marks them `duplicate` without a second extraction (`receipts.workers.ts:98-114`), so the cost is a visible junk row, not spend or bad data. Adding a Resend `email_id` column to `receipt` is the fix if it ever becomes a nuisance — deliberately deferred to keep this stage migration-free on `receipt`.
- Follow-up (not a code phase): run a handful of real forwarded e-receipts through the worker before trusting HTML category prefill, alongside stage 5's outstanding ~10-receipt eval (design `:137`).

> Whole-branch validation note (`/validate`, all four phases).
>
> **Suite.** `make check` (Biome 218 files, tsc, `db:check` no drift) and `make test`
> (403/40) pass. `make build` fails locally on missing `DEPLOYMENT_URL` /
> `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — pre-existing prod-only keys absent
> from `.env`, not a branch regression; `SKIP_ENV_VALIDATION=1 pnpm run build`
> succeeds and routes both `/settings` and `/api/receipts/inbound`. `make test_e2e`
> is a stub (no runner wired).
>
> **All seven whole-branch invariants above hold.** No `receipt`/`receipt_item`
> schema change; `drizzle/0010_messy_satana.sql` is the only new migration and adds
> only `allowed_sender`; the allowlist is consulted at `email-ingest.ts:175-189`
> before any `listAttachments`/`fetchBytes`/`put`/mint; the webhook verifies the raw
> body (`route.ts:93`), 401s on missing or bad signature (`:109,:119-123`), 200s a
> drop (`:136-139`) and lets genuine failures throw; every event goes through
> `buildOutboxEvent` + `commitWithOutbox` (`:234,:251`) with no bare `inngest.send`
> outside the rails; `EVENT_REGISTRY` is byte-identical and only the worker golden
> moved; plain-router style held. ADRs: all four the plan cites are `Accepted`, none
> `Proposed`. Reference integrity: 100 anchors checked, 0 broken, 4 stale — all four
> describe pre-implementation state this plan itself changed.
>
> **Blocker found and fixed.** `isText` was exact string equality, but the worker's
> `mediaType` is the blob's raw HTTP `content-type` response header
> (`receipts.workers.ts:242` → `@vercel/blob/dist/index.js:201`), not the row's
> value. The row carries our own bare string (`email-ingest.ts:167`), so the **UI**
> branch was safe; the **extraction** branch was not — a `text/html; charset=utf-8`
> header fell through to the image part, the exact regression phase 4 exists to
> prevent, parking the receipt as `Failed`. Phase 4's implementation note claiming
> both branches "key off the same value" is wrong on both halves.
>
> Fixed by normalising in one place: `bareMediaType()` in `src/lib/utils.ts` strips
> parameters and lower-cases, and both `isPdf` and `isText` compare against it. The
> PDF file part now also carries the bare type rather than the raw header — Anthropic
> rejects a parameterised one, the same bug a step later. 20 new cases pin the
> parameterised, upper-case and padded forms across `utils.test.ts` and
> `extraction.test.ts`.
>
> **Also open, in priority order:** the forwarded email body has no size cap (the
> attachment path caps at 10 MB) and is folded into the prompt whole; untrusted
> markup is concatenated into the *same* text part as the instructions with no
> `<untrusted_email>` fence; `previewIcon` blocklists where the proxy allowlists, so `null`/`image/gif` still
> render a broken `<img>`; `receipt-detail` asserts "Arrived by email" from
> client-supplied `contentType` rather than server-set `channel`; the media-type→
> presentation decision is duplicated across `SourcePane` and `previewIcon` while
> `src/domain/receipts/receipt-media.ts` sits empty of it; `isText` landed in the
> client-heavy `src/lib/utils.ts`, dragging `clsx`/`tailwind-merge`/four `Intl`
> formatters into the worker cold start; `receipts.workers.test.ts:162` asserts a
> tautology over two stubs and never reaches `buildExtractionContent`;
> `memberFacingError` still tells an email member to "upload a clearer photo"; the
> email pane has no download affordance; `runProcessReceipt` was demoted to an
> anonymous arrow, losing its name in Inngest stack traces; the `image/heic` test
> case is unreachable from any real path.
>
> **Carried from phase 2, still not done and never recorded:** `/settings` has no
> `error.tsx` and all three panels mount together (`settings-view.tsx:113-117`), so
> an `allowedSender.list` failure blanks the page including the theme control. (The
> other two carried items — `remove` ownership scope, the `AllowedSender` shadow —
> are both fixed.)
>
> **Plan text now stale vs shipped code:** the DTO field is `anchor`, not `value`;
> Settings ships as a separate `settingsLink` outside `links`;
> `AllowedSenderListItem` gained `isOwn`; phase 2's `remove` bullet still describes
> the unscoped delete; `route.ts` has an unplanned 500 "Not configured" branch and
> `email-ingest.ts` an unplanned `empty` branch; `docs/README.md` was updated
> (correctly) without appearing in any `### Changes` list.
>
> **Reviews.** `/security-review` — no findings (indirect prompt injection
> considered and dismissed: no tools, Zod-constrained output, category ids
> re-filtered, no SQL/DOM sink). `/code-review` — 14 findings, folded above.
> `/quality-control` — Repeated Switches (the media-type cascade, now 4 sites),
> Primitive Obsession on the raw MIME string, `isText` placement, `previewIcon`
> naming, and the arrow-function churn. `/code-comment` judge — 8 comments, 6 PASS,
> 2 REWRITE, both applied. `/design-review` — not re-run: every UI surface on the
> branch is byte-identical to the commit each per-phase review already cleared
> (phases 1, 2, 3 and 4 all recorded clean above); their open mediums stand.
>
> **Still needs a human:** forwarding a real e-receipt end to end (phase 3's two
> boxes and phase 4's first). No mail has been forwarded yet; the only writer is the
> Svix-signed webhook, and a direct DB probe is blocked by the repo's
> `block-env-file-read` hook. The charset blocker that would have failed the HTML
> case is fixed, so this is now a clean first run.
>
> Suite after the two fixes: `make check` ✓, `make test` ✓ 425/40 (was 403),
> `SKIP_ENV_VALIDATION=1 pnpm run build` ✓.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — build order item 6 (`:146`), email path (`:95`), decision 8 sender allowlist (`:29`), `allowed_sender`/`app_setting` tables (`:58-59`), error handling (`:129`); carries `## Related ADRs` (`:149-154`)
- Prior plans: `thoughts/plans/2026-09-04-expense-linking-stage-5.md` (the pipeline this extends; stage-6 boundary at `:26`), `thoughts/plans/2026-09-01-expense-linking-stage-4.md` (outbox/Inngest rails), `thoughts/plans/2026-09-03-inngest-local-dev-server.md` (local worker runs)
- ADRs (all **Accepted**; no new ADR and no Proposed ADR to implement — the design's ADR appendix is fully resolved): `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` (outbox write door + at-least-once — consumed by Phase 3); `docs/adr/adr010-single-nullable-fk-transaction-expense-link.md` (per-item granularity via receipt line items — extended to the email Channel); `docs/adr/archived/adr012-defer-adr004-plain-routers-for-feature-work.md` (plain-router style — governs every phase); `docs/adr/adr005-per-domain-drizzle-schema-files.md` (schema home — Phase 2)
- Rails and sinks: `src/server/outbox/commit.ts:32-60`, `src/server/inngest/events.ts:9-36`, `src/server/inngest/functions.ts:13-17`, `src/server/receipts/receipts.workers.ts:67-238`, `src/app/api/receipts/[id]/image/route.ts:13-61`
- Patterns to mirror: `src/app/_components/dashboard/balance-snapshot-card.tsx:17-99` (small form + mutation), `src/app/_components/expenses/categories-view.tsx:22-160` (list/add/delete + `DeleteConfirmDialog`), `src/app/(dashboard)/receipts/page.tsx:1-11` (RSC prefetch shell), `src/server/api/routers/receipts.ts:57-82,287-292` (producer + `23505` mapping), `src/server/api/routers/receipts.mutations.test.ts:1-38` (router unit-test fakes), `src/server/receipts/receipts.schema.ts:23-64` (table idioms), `src/app/_components/app-nav.tsx:30-44` (nav)
- Library docs: Resend inbound — `email.received` webhook is metadata-only; body via `emails.receiving.get`, attachment bytes via `emails.receiving.attachments.list` → expiring `download_url`; Svix verification through `resend.webhooks.verify` over the raw body. Next 16.3.0 route handlers — `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
