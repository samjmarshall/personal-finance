---
date: 2026-10-07
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022, adr023, adr024, adr025]
status: Ready to implement
---
# tRPC 3-tier migration, step 7: receipts — Implementation Plan

## Context

Steps 1–6 shipped. Receipts is the last plain router: `src/server/api/routers/receipts.ts` talks to five domains' tables through `ctx.db`. The image route queries `receipts` directly. The email repository writes `receipts` rows. The worker reads `categories`. This is migration step 7 of the design (`:835-848`).

The step:
- splits Receipts into two services (design `:242-250`)
- moves every Receipt write and read behind the receipts domain
- moves allowed senders out of `email/` into their own domain, so email checks the allowlist through their service (adr023)
- retires the `commitWithOutbox` shim and `src/server/api/lib/`
- ends with a feature commit that applies the linked-Expense rule to line items (adr025)

The tRPC paths (`api.receipt.*`), the HTTP routes and the frozen event names do not change.

## Current State

- **Precondition.** Met. `drizzle/0017_expense_delete_keeps_category.sql` (a `BEFORE DELETE` trigger on `expense`) landed in 2e229a3, and `0018_rename_category_pkey.sql` in 0fd693f. Step 7's migrations are therefore `0019` and `0020`.
- **The router** (`src/server/api/routers/receipts.ts`, 352 lines):
  - Imports `drizzle-orm` (`:3-12`), the `api/lib` helpers (`:31-32`), and the schemas of `auth` (`:34`), `categories` (`:35`), `expenses` (`:37`), `receipts` (`:41`) and `transactions` (`:42`). It writes through `commitWithOutbox` (`:40`).
  - `ITEM_FK_CONFLICT_MESSAGE` `:46-49`.
  - `create` `:56-77`:
    - inserts a pending upload row with `currentTraceId()`
    - emits `receipt/uploaded`
  - `list` `:84-111`:
    - left-joins `user` and `transaction` for `userName` and `transactionDescription`
    - optional `status` and `unmatchedOnly` filters
    - orders by `createdAt desc, id desc`
  - `get` `:115-150`:
    - joins `transaction` for the description
    - items join `expense` and `category` for names, ordered by id
    - builds `traceUrl` from `env.POSTHOG_UI_HOST` / `POSTHOG_PROJECT_ID` (`:144-147`)
  - `retry` `:155-186`:
    - the update is guarded on `status = failed`
    - it sets a new `traceId` and clears `error`
    - a miss throws inside the transaction: "Receipt not found or not in a failed state."
  - `delete` `:192-222`:
    1. a miss → "Receipt not found."
    2. any duplicate copy → CONFLICT "Delete the duplicate copies of this receipt first."
    3. delete the row
    4. best-effort `del(blobPathname)`, whose failure is swallowed
  - `matchCandidates` `:227-275`:
    - a miss → NOT_FOUND
    - a null `total`, or no window, returns `[]` with no second query
    - scans `transaction` left-joined to `receipt` over `[from, to)`
    - passes the result to `matchCandidates` (`src/domain/receipts/match.ts:70`)
  - `confirmMatch` `:279-307`:
    - a unique violation → CONFLICT "That transaction already has a receipt."
    - an FK violation → "That transaction no longer exists."
    - a miss → NOT_FOUND
  - `setItemExpense` `:310-329` and `setItemCategory` `:332-351`: each writes one column. An FK violation → `ITEM_FK_CONFLICT_MESSAGE`. A miss → "Receipt item not found."
- **Router tests** (`src/server/api/routers/`):
  - `receipts.create.test.ts` (mock outbox `:7-23`, cases `:61`, `:82`)
  - `receipts.get.test.ts` (`recordingDb` `:98`, cases `:102-141`)
  - `receipts.list.test.ts` (4 predicate cases `:41-63`, no SQL snapshot)
  - `receipts.match.test.ts` (confirmMatch `:60-108`, setItemExpense `:110-142`, setItemCategory `:144-160`, matchCandidates `:182-239`)
  - `receipts.mutations.test.ts` (retry `:62-106`, delete `:120-178`)

  No SQL snapshots exist for list, retry, delete, matchCandidates, confirmMatch or the item writes.
- **The worker** (`src/server/receipts/`):
  - `ReceiptsService` (`receipts.service.ts:234`, deps `:220-228`).
  - `DrizzleReceiptsRepository` (`receipts.repository.ts:50`, port `:24-44`).
  - `listCategories` (`:98-102`) selects `categories` with no order. It is called at `receipts.service.ts:391`, with the unknown-id guard at `:398-409`.
  - Built in `src/server/inngest/functions.ts:24-36`.
  - The worker uses only `blobStore.read` (`receipts.service.ts:296`).
- **The image route** (`src/app/api/receipts/[id]/image/route.ts`, no tests):
  - session → 401 (`:31-32`)
  - bad id → 404 (`:34-36`)
  - selects `blobPathname` with `db` (`:38-42`)
  - `get` non-200 → 404 (`:44-46`)
  - downgrades to `application/octet-stream` outside `RENDERABLE_TYPES` (`:13-17`, `:48-50`)
  - sets `nosniff` and `private, no-store` (`:52-61`)
  - uses `NextResponse`
- **The upload route** (`src/app/api/receipts/upload/route.ts`):
  - `MAX_UPLOAD_BYTES` `:19`, `SPAN_NAME_BY_EVENT` `:23-26`, `UnauthorizedError` `:30-34`
  - `failureStatus` `:38-44`, `isUploadBody` `:48-58`, `badBody` `:62-67`
  - `handle` `:78-161`:
    - reads the session only for token requests (`:90-93`)
    - wraps the work in `withSpan` (`:94-99`)
    - calls `handleUpload` with the policy (`:102-121`, policy `:111-116`)
    - maps errors (`:124-158`)
  - `POST = withFlush(handle)` (`:163`)
  - `handleUpload` resolves the Blob token **before** it calls `onBeforeGenerateToken(body.payload.pathname, …)` (`node_modules/@vercel/blob/dist/client.js:248-257`, v2.8.0).
  - Its test (`route.test.ts:113-279`) mocks `handleUpload` (`:59-73`) but never asserts the policy.
- **The email write.**
  - `DrizzleEmailRepository.createPendingReceipts` (`src/server/email/email.repository.ts:58-89`):
    - imports `receipts.schema` (`:7`)
    - takes `outbox: OutboxWriteDoor` (`:33-36`)
    - emits `receipt/email.received` per row
  - `EmailService.ingest` calls it with `currentTraceId()` (`email.service.ts:133-137`).
  - Repository tests: `email.repository.test.ts:97-157`. Service fake: `email.service.test.ts:128-136`. Trace test: `:399-410`.
  - The inbound route builds the repository with `outboxService` (`src/app/api/receipts/inbound/route.ts:33-36`). Its test mocks `outbox.module` (`route.test.ts:21`) and `~/server/db` (`:20`).
- **Allowed senders** live as prefixed files in `src/server/email/`, the last child adr023 no longer allows there:
  - `allowed-sender.{schema,repository,service,trpc.controller}.ts`, each with a test
  - `AllowedSenderService` (`allowed-sender.service.ts:16`, deps `:11-14`: `repository` and `members: Pick<MembersService, "namesByIds">`)
  - `DrizzleAllowedSenderRepository` (`allowed-sender.repository.ts:18`, port `:7-12`)
  - the router exports `allowedSenderRouter` (`allowed-sender.trpc.controller.ts:4`)
  - the kernel is `src/domain/email/allowed-sender.{dto,interface}.ts` plus `allowed-sender.dto.test.ts`, re-exported with the email types by `src/domain/email/index.ts`
  - importers: `services.ts:9-10,54-57`, `root.ts:6,14`, `src/server/db/index.ts:8,18`, `schema-interface-contract.test.ts:7,14` and `src/app/(dashboard)/settings/_components/allowed-senders-section.tsx:10-13`
  - Email reads the table itself: `DrizzleEmailRepository.findAllowedSender` (`email.repository.ts:47-56`), called at `email.service.ts:98`. Fake: `email.service.test.ts:131-132`. Test: `email.repository.test.ts:76-95`.
  - The architecture test's own-domain example is `email.repository.ts` importing `./allowed-sender.schema` (`architecture.test.ts:177-185`).
- **The shim.** `src/server/outbox/index.ts`:
  - `commitWithOutbox` `:9-12` and `publish` `:14-15`
  - only the router and its tests import the barrel
  - `src/server/api/lib/` (`assert-row.ts`, `parse-error.ts`) is imported only by the router (`:31-32`)
  - `OutboxRepository.commit` skips the outbox insert when the event list is empty (`outbox.repository.ts:64`)
- **Wiring.**
  - `src/server/api/services.ts` builds categories, expenses, members and transactions inline (`:24-49`). It has no `receipts` key (`:53-71`).
  - `root.ts:1,20` serves `receipt` from the router.
  - Modules: only `outbox.module.ts` exists (`:8-15`).
- **The architecture to-do list** (`src/server/architecture.test.ts:38-49`) has 10 entries, all receipts:
  - `:39` the email repository → `receipts.schema`
  - `:40` the worker repository → `categories.schema`
  - `:41-46` the router ×6
  - `:47-48` the image route
- **Supporting services.**
  - `namesByIds` returns a `ReadonlyMap` and skips the query on an empty list:
    - members (`src/server/auth/members.service.ts:17`, string ids)
    - expenses (`expenses.service.ts:61`, `{ name, categoryId }`)
    - categories (`categories.service.ts:82`)
  - `TransactionsService` has no description lookup and no window scan (`transactions.service.ts:55-169`).
  - `CategoriesService.list` orders by `sortOrder, name` (`categories.repository.ts:42-47`).
  - `posthogTraceUrl(config, traceId)` (`src/lib/posthog-trace-url.ts:12-23`).
- **Blob store.** `BlobStore { read, write }` (`src/server/blob-store/blob-store.ts:15-24`). The email service uses only `write` (`email.service.ts:184`).
- **Line items.**
  - `receipt_item` has no check constraint (`receipts.schema.ts:69-94`, extra-config `:93`).
  - The precedent is `transactions.schema.ts:46-50` with `TransactionsService` link/unlink (`:124-172`).
  - The picker UI (`src/app/(dashboard)/receipts/_components/receipt-detail.tsx`):
    - `matched` gate `:264-266`
    - pickers `:434-469`, with the Category picker's `value={item.categoryId}` at `:468`
    - header "Attribute to" `:405`
    - hint "…to attribute items to an expense or category." `:490-491`
  - The read-only precedent is `transaction-form.tsx:96-122,227-236`. `SelectField` has `readOnly` and `aria-describedby` (`src/components/select-field.tsx:41-69`).
- **"attribut" on line items**:
  - `receipt-detail.tsx:264,276,280,281,405,490`
  - `src/domain/receipts/receipt.dto.ts:33`
  - `receipts.schema.test.ts:69`
  - the router (`:46,114,309,331`) and its tests (`receipts.get.test.ts:128`, `receipts.match.test.ts:111,145`), which Phase 4 deletes
  - Member uses stay.
- **Glossary.** CONTEXT.md already states the line-item rule (`:116-123`) and the "attribute" ambiguity (`:211-213`). No change is needed.

## Desired End State

- `src/server/receipts/` holds one domain with two services:
  - **`ReceiptExtractionService`** (`receipt-extraction.service.ts`) over `ReceiptExtractionRepository` serves the worker. It reads Categories through `categories: Pick<CategoriesService, "list">`.
  - **`ReceiptsService`** (`receipts.service.ts`) over `ReceiptsRepository` owns every Receipt row on every channel. It serves:
    - `receipts.trpc.controller.ts` (`receiptRouter`)
    - `receipts.http.controller.ts` (image and upload)
    - `EmailService` (`createFromEmail`)
- Module files:
  - `categories.module.ts`, `expenses.module.ts`, `transactions.module.ts`, `src/server/auth/members.module.ts`, `receipts.module.ts` and `allowed-senders.module.ts` each export one instance.
  - `services.ts`, `functions.ts` and the three receipt routes import them.
- Allowed senders are their own domain: `src/server/allowed-senders/` and `src/domain/allowed-senders/`. `EmailService` checks a sender through `AllowedSendersService.memberFor` and has no repository.
- Gone:
  - `src/server/api/routers/receipts.ts` and its five tests
  - `src/server/email/email.repository.ts` and its test
  - `src/server/outbox/index.ts`
  - `src/server/api/lib/`
- The architecture to-do list is empty.
- No route under `src/app/api/receipts/` imports `db`, `drizzle-orm` or a schema.
- A line item is linked to an Expense **or** filed under a Category, never both:
  - check `receipt_item_expense_or_category_check`
  - linking clears the Category
  - unlinking copies the Expense's Category back
  - `get` shows the effective Category
  - the picker is read-only while linked
- No line-item copy or code comment says "attribute".

## Out of Scope

- adr019's `requireReceiptAccess`. The image route keeps today's access: any signed-in Member.
- Removing `ctx.db` and `src/server/api/routers/`, and rewriting the rules file's router section. Those are step 8.
- Sharing `MAX_UPLOAD_BYTES` with the worker's Bedrock size guard (`receipts.service.ts:63-65`).
- Logging the swallowed blob-delete failure.
- Filtering or sorting receipts by the effective Category.
- Dropping the `0017` trigger's `coalesce` for line items. It stays correct.
- Renaming the `allowed_sender` table or the `allowedSender` router key.

## Approach

Strangler, in the shape of the allowlist (f2d8107 / 5d68c58 / 2a87771) and cashflow (c040b47 / 170d250 / 9c262b3):
1. Characterize first, with SQL snapshots.
2. Build the new tiers and re-point the characterization tests at the real services on `recordingDb`, so only the SQL changes.
3. Delete the old code in its own commit.

The worker rename is a pure rename commit. Module files land before any second root needs them. The HTTP routes and the email write follow the tRPC move, because they reuse `ReceiptsService`. Allowed senders move once email stops writing receipts, so `EmailRepository` holds only the allowlist read and can go. Shim removal is a cleanup commit. The line-item rule is the last commit, a feature, with its own migration.

Ten commits: 1, 2, 3, 4a, 4b, 5, 6, 7, 8, 9.

## Phase 1: Characterize the router and the receipt routes

One test-only commit: `test(receipts): characterize router and routes`. No production code changes.

### Changes

- **Shared setup** for the router tests:
  - Build the caller over `recordingDb(respond)` (`src/server/db/recording-db.fake.ts`).
  - Replace the per-file outbox mocks with one fake `commitWithOutbox`. It runs `writes(db)` and records `events(result)`, so the insert SQL lands in the snapshot.
  - Keep `vi.mock("@vercel/blob")` for `del`.
- **`receipts.create.test.ts`**:
  - SQL snapshot of the insert
  - one `receipt/uploaded` with the new id
  - `userId` comes from the session, never the input
- **`receipts.list.test.ts`** — convert the four predicate cases (`:41-63`) to SQL snapshots:
  - no filter → no WHERE
  - `status`
  - `unmatchedOnly`
  - both
- **`receipts.get.test.ts`**:
  - keep `:102-141`
  - add a `traceUrl` case with a project id
  - snapshot both queries
- **`receipts.mutations.test.ts`**:
  - **retry**: snapshot the guarded update plus `begin`/`rollback`. A miss gives the exact message. A hit emits one `receipt/retry`.
  - **delete**:
    - a miss gives the NOT_FOUND message
    - a duplicate gives the CONFLICT message, and no delete runs
    - a hit snapshots select, duplicate probe and delete, then calls `del(blobPathname)`
    - `del` throwing still returns `{ success: true }`
- **`receipts.match.test.ts`**:
  - **matchCandidates**:
    - snapshot both queries
    - a null `receiptDate` or a null `total` returns `[]` with one query
    - a miss → NOT_FOUND message
  - **confirmMatch**: snapshot. Unique → CONFLICT message. FK → CONFLICT message. A miss → NOT_FOUND.
  - **setItemExpense / setItemCategory**, each:
    - snapshot
    - `null` clears
    - FK → `ITEM_FK_CONFLICT_MESSAGE`
    - a miss → "Receipt item not found."
- **`src/app/api/receipts/[id]/image/route.test.ts`** (new):
  - Mocks: `~/server/auth` `getSession`, `~/server/db` as a `recordingDb`, and `@vercel/blob` `get`.
  - Cases:
    - signed out → 401 "Unauthorized", no query
    - id `abc` → 404, no query
    - missing row → 404, with a SQL snapshot of the select
    - `get` answers `null` or `{ statusCode: 404 }` → 404
    - a hit:
      - `get(pathname, { access: "private" })`
      - body bytes streamed
      - `Content-Type: image/png`
      - `X-Content-Type-Options: nosniff`
      - `Cache-Control: private, no-store`
    - a `text/html` blob → `application/octet-stream`
- **`src/app/api/receipts/upload/route.test.ts`** — one new case, "mints with the receipt upload policy":
  - Capture the `handleUpload` options.
  - Call `onBeforeGenerateToken("receipts/a.jpg")`. Expect:
    - `allowedContentTypes: [...RECEIPT_FILE_TYPES]`
    - `maximumSizeInBytes: 10 * 1024 * 1024`
    - `addRandomSuffix: true`
    - `tokenPayload: JSON.stringify({ userId: "member-1" })`
  - Expect `onUploadCompleted` to be a function, so Blob still sets the callback URL.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] Every procedure has a SQL snapshot and asserts its exact member-facing message
- [x] `git diff --stat` touches only `*.test.ts` files

## Phase 2: Rename the worker to `ReceiptExtractionService`

One pure-rename commit: `refactor(receipts): rename worker to ReceiptExtractionService`. Behaviour, function ids and logger attributes are unchanged.

### Changes

- `git mv`:
  - `receipts.service.ts` → `receipt-extraction.service.ts`
  - `receipts.repository.ts` → `receipt-extraction.repository.ts`
  - the matching `.test.ts` files
- Rename the symbols:
  - `ReceiptsService` → `ReceiptExtractionService`, and `ReceiptsServiceDeps` to match (`:220-247`)
  - `ReceiptsRepository` → `ReceiptExtractionRepository` (`:24-44`)
  - `DrizzleReceiptsRepository` → `DrizzleReceiptExtractionRepository`, and its deps to match (`:46-55`)
- `receipts.inngest.controller.ts:3,12,20` and its test (`:3,33`) — import and type the new class.
- `src/server/inngest/functions.ts:9-11,24-36` — new imports and names. Keep `{ domain: "receipts", component: "service" }`.
- Tests:
  - `receipt-extraction.service.test.ts` (`:37-44,136,179,218`)
  - `receipt-extraction.repository.test.ts` (`:4-8,48,74,104,157-166`)
  - the `prompt-redaction.test.ts:123` comment
- `src/server/architecture.test.ts:40` — the entry's path becomes `src/server/receipts/receipt-extraction.repository.ts`.
- Docs:
  - `.claude/rules/bedrock-invocation.md:13-14` — the file and class name.
  - `.claude/rules/server-architecture.md`:
    - `:16` — the reference implementation is `receipts/receipt-extraction.*`
    - `:30` and `:99` — `ReceiptExtractionService`
  - `docs/adr/adr004-*.md`:
    - `:66`, `:89` — `new ReceiptExtractionService(...)`
    - `:69`, `:80` — `DrizzleReceiptExtractionRepository`, `ReceiptExtractionService`
  - `docs/adr/adr015-*.md:54` — `ReceiptExtractionService`.

### Success

- [x] `make check` passes
- [x] `make test` passes. `registry-golden.test.ts` is unchanged and green.
- [x] `git show --stat` shows the renames as `R` with no logic hunks

## Phase 3: Module files; the worker reads Categories through the service

One commit: `refactor: shared module files, worker reads Categories via service`.

### Changes

- **New module files.** Each exports one instance and copies the `new` calls now in `services.ts:20-49`:
  - `src/server/categories/categories.module.ts` → `categoriesService`
  - `src/server/expenses/expenses.module.ts` → `expensesService`
  - `src/server/auth/members.module.ts` → `membersService`. Move the comment "Off `services`: no controller calls it, only other services." (`services.ts:36`).
  - `src/server/transactions/transactions.module.ts` → `transactionsService`. It imports the expenses and categories modules (design `:381-404`).
- **`src/server/api/services.ts`** — import the four instances. Delete their inline `new` calls and the repository imports. The `services` keys and the `Services` type are unchanged.
- **`receipt-extraction.service.ts`**:
  - Add `categories: Pick<CategoriesService, "list">` to the deps.
  - `extractAndSave` (`:386-391`) maps `list()` to `{ id, name }`.
  - The prompt now lists Categories in page order (`sortOrder, name`) instead of heap order.
- **`receipt-extraction.repository.ts`** — drop `listCategories` from the port and the class (`:34-35`, `:98-102`), and drop the `categories.schema` import (`:4`).
- **`receipt-extraction.service.test.ts`** — fake `categories.list` instead of the repository's `listCategories` (`:147`). Add one case: the prompt gets the list in the order `list()` gave.
- **`receipt-extraction.repository.test.ts`** — drop the `listCategories` case and every trace of the categories table in the fake `db`: the `categories.schema` import (`:4`), the dispatch note (`:18-19`), the `categoryRows` option (`:22`) and its branch (`:48`).
- **`src/server/inngest/functions.ts`** — pass `categories: categoriesService` from `categories.module`. Update the root comment (`:14-17`): the outbox and categories services come from module files.
- **`src/server/architecture.test.ts:40`** — delete the entry.
- **Docs**:
  - `.claude/rules/server-architecture.md`:
    - `:31` (module row) — list the five modules
    - `:75-80` — `services.ts` imports shared instances from `*.module.ts`
  - `docs/adr/adr024-*.md:74` — add "Done in step 7: `ReceiptExtractionService` takes `categories: Pick<CategoriesService, "list">`." This implements adr024's worker clause.
  - `docs/adr/adr023-*.md` — no edit. The module files follow its flat-folder rule.

### Success

- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes. Module load throws on no missing env var.
- [x] No file but a composition root or a module imports a `*.module.ts` (`grep -rn "\.module\"" src`). The shim `src/server/outbox/index.ts` still hits until Phase 8 deletes it.
- [x] `/security-review`: `src/server/auth/members.module.ts`. No findings.

## Phase 4: Member-facing `ReceiptsService` and the tRPC controller

Two commits, built by the TDD vertical-slice loop (one test → one implementation, per method):
- **4a** `refactor(receipts): ReceiptsService behind receipt router`
- **4b** `refactor(receipts): delete receipts router`

Implements adr021 (controller naming, `:76`) and adr022 (batched lookups, `:50`; upward-call graph, `:53`).

### Changes (4a)

- **`src/server/receipts/receipts.repository.ts`** (new) — `interface ReceiptsRepository` + `class DrizzleReceiptsRepository`, with deps `{ db, outbox: OutboxWriteDoor }`. Own tables only. Methods:
  - `insertPending(rows: PendingReceipt[], event: "receipt/uploaded" | "receipt/email.received"): Promise<Receipt[]>`. Sets `status: Pending` and goes through `outbox.commit`, one event per row.
  - `findAll({ status?, unmatchedOnly? }): Promise<Receipt[]>`. `and()` drops the unset arms. Ordered `createdAt desc, id desc`.
  - `findById(id)`
  - `findItems(receiptId)`, ordered `id asc`
  - `requeueFailed(id, traceId): Promise<Receipt | undefined>`:
    - goes through `outbox.commit`
    - the update is guarded on `status = failed` and sets `{ status: Pending, traceId, error: null }`
    - `receipt/retry` fires only when a row came back
    - an empty list skips the outbox insert (`outbox.repository.ts:64`)
  - `findBlobPathname(id)`
  - `deleteUnlessDuplicated(id): Promise<{ blobPathname: string } | "missing" | "has-duplicates">`. One `this.db.transaction`:
    - `select blobPathname … for update`. The lock makes a copy being marked against this row wait, since the FK check needs the row.
    - the duplicate probe (`limit 1`), then the delete
    - Today the probe and the delete are separate statements (`receipts.ts:202-213`). A copy marked between them is stranded by `set null`.
  - `findMatchInput(id): Promise<{ total; receiptDate } | undefined>`
  - `findMatchedTransactionIds(transactionIds): Promise<number[]>`. No query when the list is empty.
  - `setTransaction(id, transactionId)`, `setItemExpense(itemId, expenseId)`, `setItemCategory(itemId, categoryId)`. Each returns the row or `undefined`.
- **`receipts.repository.test.ts`** (new) — `recordingDb` snapshot per method. For `insertPending` and `requeueFailed`, a fake `OutboxWriteDoor` records the events.
- **`src/server/transactions/`**:
  - `TransactionsService.descriptionsByIds(ids): Promise<ReadonlyMap<number, string>>`. No query when empty.
  - `TransactionsService.inDateWindow(from, to)`. The window is `[from, to)` and rows are `{ id, description, amount, date }`.
  - Repository `findDescriptions(ids)` and `findInDateWindow(from, to)` (`gte` / `lt`, as at `transactions.repository.ts:205-229`).
  - Add service cases and SQL snapshots.
- **`src/server/blob-store/blob-store.ts`** — `BlobStore.delete(pathname)`. `VercelBlobStore` calls `del(pathname)`. `blob-store.test.ts` mocks `del` too.
- **Narrow the blob deps**:
  - the worker → `blobStore: Pick<BlobStore, "read">`
  - `EmailService` → `blobStore: Pick<BlobStore, "write">` (`email.service.ts:74,82`)
- **`src/server/receipts/receipts.service.ts`** (new) — `ReceiptsService`.
  - **Deps:**
    - `repository: ReceiptsRepository`
    - `members: Pick<MembersService, "namesByIds">`
    - `transactions: Pick<TransactionsService, "descriptionsByIds" | "inDateWindow">`
    - `expenses: Pick<ExpensesService, "namesByIds">`
    - `categories: Pick<CategoriesService, "namesByIds">`
    - `blobStore: Pick<BlobStore, "delete">`
    - `posthogUi: PosthogUiConfig`
  - Comment: Receipts → members, transactions, expenses and categories are downward calls (adr022).
  - **`create(memberId, input)`** → `insertPending([{ userId: memberId, channel: Upload, …input, traceId: currentTraceId() }], "receipt/uploaded")`. Returns the row.
  - **`list(filter)`**:
    - `findAll`, then `members.namesByIds` and `transactions.descriptionsByIds` in parallel
    - merge in memory
    - a missing id gives `null`
  - **`get(id)`**:
    - `findById`; a miss → `NotFoundError("Receipt not found.")`
    - then `findItems`, `transactions.descriptionsByIds`, `expenses.namesByIds` and `categories.namesByIds` (the items' own ids)
    - `traceUrl = posthogTraceUrl(this.posthogUi, receipt.traceId)`
  - **`retry(id)`** → `requeueFailed(id, currentTraceId())`. A miss → `NotFoundError("Receipt not found or not in a failed state.")`.
  - **`delete(id)`**:
    1. `deleteUnlessDuplicated`. `"missing"` → `NotFoundError("Receipt not found.")`
    2. `"has-duplicates"` → `ConflictError("Delete the duplicate copies of this receipt first.")`
    3. `blobStore.delete`, after the commit, inside a try/catch that swallows the failure. Keep the router's comments (`:188-191`, `:216-220`).
  - **`matchCandidates(receiptId, timeZone)`**:
    - a miss → `NotFoundError`
    - a null `total` or no `matchScanWindow` → `[]`
    - otherwise `transactions.inDateWindow`, then `findMatchedTransactionIds`, setting `hasReceipt`
    - then `matchCandidates(…)`
  - **`confirmMatch(receiptId, transactionId)`**:
    - unique → `ConflictError("That transaction already has a receipt.", { cause })`
    - else `rethrowFkConflict(error, "That transaction no longer exists.")`
    - a miss → `NotFoundError("Receipt not found.")`
  - **`setItemExpense` / `setItemCategory`**: FK → `rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE)`. A miss → `NotFoundError("Receipt item not found.")`. Comments say "link" and "file", never "attribute".
- **`receipts.service.test.ts`** (new):
  - object-literal fakes
  - one case per rule above, each message exact
  - `cause` kept on conflicts
  - lookups skipped on empty id lists
- **`src/server/receipts/receipts.module.ts`** (new) → `receiptsService`. It is built from:
  - `outboxService`
  - the four module instances
  - `new VercelBlobStore()`
  - `posthogUi: { uiHost: env.POSTHOG_UI_HOST, projectId: env.POSTHOG_PROJECT_ID }`
- **`src/server/receipts/receipts.trpc.controller.ts`** (new) — `receiptRouter`:
  - same procedure names and inputs (`byId` and the `list` input stay inline, as at `:44`, `:85-92`)
  - `byId` gains `.int()`. Today a decimal id reaches Postgres and 500s.
  - each procedure makes one `ctx.services.receipts.*` call
  - `create` passes `ctx.session.user.id`
  - `delete` returns `{ success: true }` (as at `transactions.trpc.controller.ts:36-40`)
- **`receipts.trpc.controller.test.ts`** (new):
  - `createTestCaller` with `Partial<ReceiptsService>` fakes
  - each procedure → its method with the parsed input
  - a decimal id → `BAD_REQUEST`, with no service call
  - `NotFoundError` → `NOT_FOUND` and `ConflictError` → `CONFLICT` through the real middleware
- **Wiring** — `services.ts` gains `receipts: receiptsService`. `root.ts:1` imports `receiptRouter` from `~/server/receipts/receipts.trpc.controller`.
- **Re-point the Phase 1 tests**:
  - The caller becomes `createTestCaller(receiptRouter, { services: { receipts } })`.
  - `receipts` is a real `ReceiptsService` over real repositories on the same `recordingDb` (`db as never`), including the real members, transactions, expenses and categories services. Its blob store is fake. Its outbox door is a fake `OutboxWriteDoor`, as in Phase 1: `commit` runs `writes` in `db.transaction` and records the events. A real door would add `insert into "outbox"` to the create and retry snapshots.
  - Expected snapshot diffs, and only these:
    - list: joins → batched `user` / `transaction` lookups
    - get: joins → lookups
    - matchCandidates: join → window scan plus matched-id probe
    - retry miss: `rollback` → `commit`
    - delete: `begin` / `commit` around the three statements, and the select gains `for update`. The 404 case's query count goes from 1 to 3.
  - Every message assertion stays unchanged.

### Changes (4b)

- Delete `src/server/api/routers/receipts.ts` and its five tests.
- `src/server/architecture.test.ts:41-46` — delete the six entries.
- Docs:
  - `.claude/rules/server-architecture.md`:
    - `:130-138` — the worker fake-db note names "receipt extraction". `ReceiptsRepository` uses `recordingDb`.
    - `:163` — `receipt` comes from `src/server/receipts/`
  - `docs/adr/adr004-*.md:81` — "Next: the image, upload and email paths, then the shim, all in step 7."

### Success

- [ ] `make check` passes
- [ ] `make test` passes. After 4a, the re-pointed tests differ from Phase 1 only in the expected SQL.
- [ ] `make build` passes
- [ ] At https://personal-finance.localhost/receipts:
  - the list, filters, detail, retry, delete, match banner, confirm and item pickers behave as before
  - each receipt shows the Member and transaction names

## Phase 5: HTTP controller for the image and upload routes

One commit: `refactor(receipts): http controller for image and upload routes`, built by the TDD loop. Implements adr021 (one `receipts.http.controller.ts` for both routes, `:76`) and adr022 (no data access in an entry point).

### Changes

- **`src/server/blob-store/blob-store.ts`** — `BlobStore.stream(pathname): Promise<StreamedBlob | null>`, where `StreamedBlob` is `{ stream, contentType }`. It returns `null` when `get` answers anything but 200, and lets throws pass. Test it in `blob-store.test.ts`.
- **`src/server/blob-store/client-uploads.ts`** (new):
  - `interface ClientUploads { answer(request, event: HandleUploadBody, grant: (pathname) => Promise<UploadGrant>): Promise<unknown> }`
  - `class VercelClientUploads`:
    - calls `handleUpload({ request, body, onBeforeGenerateToken: grant, onUploadCompleted: async () => {} })`
    - keeps the comment that `receipt.create` owns the row (`route.ts:117-119`)
  - `client-uploads.test.ts`:
    - mock `@vercel/blob/client` like `blob-store.test.ts:5`
    - assert that `grant` is wired as the token hook and that a completion hook is passed
- **`src/server/auth/session-reader.ts`** (new) — `interface SessionReader { memberId(headers): Promise<string | undefined> }` and `class BetterAuthSessionReader`, which reads `auth.api.getSession({ headers })`. `session-reader.test.ts` covers signed in and signed out.
- **`ReceiptsService`**:
  - **Deps:** `blobStore` becomes `Pick<BlobStore, "delete" | "stream">`. Add `uploads: ClientUploads`.
  - **`openImage(id): Promise<ReceiptImage>`**:
    - `findBlobPathname`; a miss → `NotFoundError("Receipt not found.")`
    - `blobStore.stream`; `null` → `NotFoundError("Receipt image not found.")`
    - downgrades outside `RENDERABLE_TYPES`, which moves here with its comment (`route.ts:9-17`)
  - **`answerUpload(request, event, memberId: string | undefined)`**:
    - calls `uploads.answer`
    - the grant throws `UploadUnauthorizedError` when `memberId` is unset
    - otherwise it returns the policy, which moves here: `RECEIPT_FILE_TYPES`, `MAX_UPLOAD_BYTES` with its comment (`route.ts:17-19`), `addRandomSuffix: true`, `tokenPayload`
    - the gate stays inside the hook, so Blob still resolves its token first
  - Export `UploadUnauthorizedError` with the comment at `route.ts:28-29`.
  - Service cases:
    - row missing → NotFound
    - blob missing → NotFound
    - `text/html` → `application/octet-stream`
    - the grant policy with a member
    - no member → `UploadUnauthorizedError`
- **`src/server/receipts/receipts.http.controller.ts`** (new) — `ReceiptsHttpController`:
  - **Deps:** `{ service: ReceiptsService, sessions: SessionReader, logger: Logger }`. It uses plain `Request` / `Response`.
  - **`image(request, id)`**:
    - signed out → 401 "Unauthorized"
    - an id that is not a plain integer in `1..2³¹−1` (the `int4` column) → 404 "Not found". Today `99999999999` reaches Postgres and 500s, and `1e3` reads as 1000.
    - `NotFoundError` → 404 "Not found"
    - otherwise streams with the three headers (`route.ts:52-61`)
  - **`upload(request)`** — moves `handle` (`route.ts:78-161`):
    - moves `SPAN_NAME_BY_EVENT`, `isUploadBody`, `failureStatus` and `badBody` (now `Response.json`)
    - the session read stays token-only
    - the span sets `blob.pathname` from `body.payload.pathname` when a token request has a member. This matches today's span: the hook gets that same pathname.
    - the span, the logs and the status mapping are unchanged
- **`receipts.http.controller.test.ts`** (new):
  - fake service and fake `SessionReader`
  - move the image cases and the upload route cases (`route.test.ts:114-297`) here, with the span exporter (`:80-81`) and the logger fake (`:39-57`)
- **Routes** — composition roots with a lazy `compose()` memo, as at `inbound/route.ts:24-44`:
  - **`[id]/image/route.ts`**:
    - builds the controller from `receiptsService`, `new BetterAuthSessionReader()` and a logger with `component: "image-route"`
    - `GET` → `compose().image(request, (await ctx.params).id)`
    - no `db`, `drizzle-orm` or schema import
  - **`upload/route.ts`** — logger `component: "upload-route"` (unchanged). `POST = withFlush((request) => compose().upload(request))`.
  - **Both `route.test.ts`** mock `receipts.module` and the controller module, and assert only the root's job: built once, then delegates. Upload also asserts that the flush is scheduled.
- **`src/server/architecture.test.ts:47-48`** — delete the entries.
- **`.claude/rules/bedrock-invocation.md:13`** — the 10 MB upload cap lives in `receipts.service.ts` (`MAX_UPLOAD_BYTES`). The guard is in `receipt-extraction.service.ts`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] At https://personal-finance.localhost/receipts:
  - an upload mints, creates the row and extracts
  - the detail image renders
  - signed out, `/api/receipts/1/image` gives 401
  - in DevTools, the image response carries `nosniff` and `private, no-store`
- [ ] `/security-review`: `src/server/auth/session-reader.ts`, both routes, the upload policy

## Phase 6: The email write goes through `ReceiptsService`

One commit: `refactor(email): mint receipts through ReceiptsService`, built by the TDD loop. Implements adr022 `:52`.

### Changes

- **`ReceiptsService.createFromEmail(memberId, blobs: StoredBlob[]): Promise<number[]>`**:
  - calls `insertPending(blobs.map(… channel: Email, traceId: currentTraceId() …), "receipt/email.received")`
  - returns the ids in input order
  - move `StoredBlob` (`email.repository.ts:10-15`) here and export it
  - move the comment about the orphan-blob trade (`:58-61`)
- **`receipts.service.test.ts`**:
  - one pending email row per blob, with ids in order
  - one `receipt/email.received` per row
  - move the trace test from `email.service.test.ts:399-410`: "stores the active span's trace id on the minted receipt"
- **`src/server/email/email.service.ts`**:
  - add `receipts: Pick<ReceiptsService, "createFromEmail">` to the deps (`:71-90`)
  - `ingest` calls `this.receipts.createFromEmail(sender.userId, stored)` (`:133-137`)
  - drop the `currentTraceId` import (`:8`)
  - import `type StoredBlob` from `~/server/receipts/receipts.service`
- **`email.service.test.ts`** — the fake `createPendingReceipts` (`:128-136`) becomes a fake `receipts.createFromEmail`. Drop the moved trace test.
- **`src/server/email/email.repository.ts`**:
  - drop `createPendingReceipts`, the `outbox` dep and its field
  - drop the imports at `:3`, `:5`, `:6`, `:7`
  - the port comment becomes "the allowlist read"
- **`email.repository.test.ts`** — drop `:97-157`.
- **`src/app/api/receipts/inbound/route.ts:33-38`**:
  - `new DrizzleEmailRepository({ db })`
  - add `receipts: receiptsService` from `receipts.module`
  - replace the `outbox.module` import
- **Its `route.test.ts:21`** — mock `receipts.module` instead of `outbox.module`.
- **`src/server/architecture.test.ts:39`** — delete the last entry. Type the list as `const TODO: string[] = []`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `src/server/architecture.test.ts` passes with an empty to-do list
- [ ] An email from an allowed sender with a PDF creates one pending receipt that extracts. Use the existing inbound flow from `docs/feature/` on the preview, or a signed fixture POST locally.

## Phase 7: Allowed senders become their own domain

One commit: `refactor(allowed-senders): own domain, email checks the allowlist through its service`. A move first, then the TDD loop for `memberFor`. Implements adr023 (`:58`, the second promotion) and adr022 (email reads another domain's data through its service).

### Changes

- **Move the server files** with `git mv`, so history follows:
  - `src/server/email/allowed-sender.{schema,repository,service,trpc.controller}.ts` → `src/server/allowed-senders/allowed-senders.{schema,repository,service,trpc.controller}.ts`
  - the four matching `.test.ts` files
- **Rename the classes** to the folder's name, as `categories/` does:
  - `AllowedSenderService` → `AllowedSendersService`, and its deps to match (`allowed-sender.service.ts:11-23`)
  - `AllowedSenderRepository` → `AllowedSendersRepository` (`allowed-sender.repository.ts:7-12`)
  - `DrizzleAllowedSenderRepository` → `DrizzleAllowedSendersRepository` (`:18`)
  - `allowedSenderRouter` keeps its name, like `categoryRouter`: it serves the `allowedSender` key.
  - Update the moved tests' imports and names.
- **Move the kernel** with `git mv`:
  - `src/domain/email/allowed-sender.{dto,interface}.ts` and `allowed-sender.dto.test.ts` → `src/domain/allowed-senders/`
  - new `src/domain/allowed-senders/index.ts` re-exports `AllowedSender`, `AllowedSenderListItem`, `allowedSenderCreateDto` and `allowedSenderRefDto`
  - `src/domain/email/index.ts` keeps only the email types
  - File names stay singular, as in `src/domain/categories/category.*`, so `COVERED` (`schema-interface-contract.test.ts:44`) does not change.
- **The allowlist read moves to its owner** (TDD):
  - `AllowedSendersRepository.findMemberId(email): Promise<string | undefined>` holds the query from `email.repository.ts:47-56`. Keep the port note: "`email` must already be bare + lower-cased — the shape the allowlist stores." Move its two cases from `email.repository.test.ts:76-95`.
  - `AllowedSendersService.memberFor(email)` passes it through (adr004 `:71`). One service case.
- **`src/server/allowed-senders/allowed-senders.module.ts`** (new) → `allowedSendersService`, built from `db` and `membersService` (`members.module`, Phase 3). Two roots need it: `services.ts` and the inbound route.
- **`src/server/email/email.service.ts`**:
  - the deps (`:71-90`) swap `repository: EmailRepository` for `allowedSenders: Pick<AllowedSendersService, "memberFor">`
  - `ingest` (`:98`) asks `this.allowedSenders.memberFor(from)`. The drop branch and its log do not change. The baggage and `createFromEmail` take the returned member id.
  - drop the `email.repository` import (`:10`)
- **`email.service.test.ts`** — the `repository` fake (`:131-132`) becomes `allowedSenders: { memberFor: async () => allowlist[0]?.userId }`. Drop the `EmailRepository` import (`:23`).
- **Delete** `src/server/email/email.repository.ts` and `email.repository.test.ts`. Nothing is left in them.
- **Importers**:
  - `src/server/api/services.ts:9-10,54-57` — `allowedSenders: allowedSendersService`. Drop the repository and class imports.
  - `src/server/api/root.ts:6` — `~/server/allowed-senders/allowed-senders.trpc.controller`
  - `src/server/db/index.ts:8` — `~/server/allowed-senders/allowed-senders.schema`. `drizzle.config.ts` already globs `src/server/**/*.schema.ts`.
  - `src/server/db/schema-interface-contract.test.ts:7,14` — the new kernel and schema paths
  - `allowed-senders-section.tsx:10-13`, the controller and the service — import from `~/domain/allowed-senders`
- **`src/app/api/receipts/inbound/route.ts`**:
  - drop `DrizzleEmailRepository` and the `db` import
  - pass `allowedSenders: allowedSendersService` from `allowed-senders.module`
  - its `route.test.ts` mocks `allowed-senders.module`, like `receipts.module`. Drop the `~/server/db` mock (`:20`) if nothing else loads it.
- **`src/server/architecture.test.ts:177-185`** — the own-domain example becomes `src/server/allowed-senders/allowed-senders.repository.ts` importing `./allowed-senders.schema`. The receipts-schema import still flags rule 1.
- **Docs**:
  - `.claude/rules/server-architecture.md`:
    - `:48-49` — drop "`email/allowed-sender.*` is the last prefixed child; it moves to `allowed-senders/` in step 7."
    - `:159` — `allowedSender` comes from `src/server/allowed-senders/`
  - `docs/adr/adr004-*.md:80`, the Done list:
    - `src/server/email/` — `allowed-sender.trpc.controller.ts` → … becomes `src/server/allowed-senders/` — `allowed-senders.trpc.controller.ts` → `AllowedSendersService` → `AllowedSendersRepository` / `DrizzleAllowedSendersRepository`
    - `EmailService` → `EmailRepository` / `DrizzleEmailRepository` becomes `EmailService`, which checks senders through `AllowedSendersService` and mints through `ReceiptsService`
  - `docs/adr/adr022-*.md:53` — allowed senders sit above members and below email: "…transactions and allowed senders above them; receipts and email above that…"
  - `docs/adr/adr023-*.md:58` — "Allowed Sender is the second" says the move shipped in step 7.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `make db_generate` produces no file. The `allowed_sender` table did not change.
- [ ] `git show --stat` shows the moved files as renames (`R`)
- [ ] `grep -rn "email/allowed-sender\|EmailRepository\|findAllowedSender" src .claude/rules` finds nothing
- [ ] At https://personal-finance.localhost/settings:
  - the allowlist shows each address with its owner's name
  - an add works
  - a duplicate add shows "That address is already on the allowlist."
  - a remove works
- [ ] An email from an allowed sender still mints a pending receipt. One from an unknown address is dropped, with the log "inbound email dropped: unknown sender". Use the same flow as Phase 6.
- [ ] `/security-review`: the sender gate in `email.service.ts` and `allowed-senders.service.ts`

## Phase 8: Retire the shim and `src/server/api/lib/`

One commit: `refactor: retire commitWithOutbox shim and api/lib`. Implements adr021 `:77` and adr022's write rule.

### Changes

- Delete `src/server/outbox/index.ts`. It has no importers left. `OutboxWriteDoor` is imported from `outbox.service`.
- Delete `src/server/api/lib/assert-row.ts` and `parse-error.ts`.
- `src/server/outbox/outbox.module.ts:8-10` — the comment names its consumers: `receipts.module.ts` and the cron controller in `functions.ts`.
- Docs:
  - `.claude/rules/server-architecture.md`:
    - `:14-19` — add `src/server/receipts/receipts.*` (one domain, two services)
    - `:174-175` — drop the `api/lib` sentence
    - `:228-229` — drop the shim sentence
  - `docs/adr/adr004-*.md`:
    - `:68` — the module surface lists today's modules
    - `:69` — the write door example is `DrizzleReceiptsRepository.insertPending`, with no shim
    - `:80-81` — receipts is Done, and Next is step 8 (`ctx.db`)
    - `:96`, `:107` — `OutboxService.commit` in place of `commitWithOutbox`
    - `:163` — reference implementations
  - `docs/adr/adr021-*.md:77` — append "The shim retired in step 7."
  - `docs/feature/receipt-trace-diagnostics.md:29-30` — `ReceiptsService.create` / `retry` / `createFromEmail` stamp the trace id, and `get` builds `traceUrl`.

### Success

- [ ] `make check` passes
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] `grep -rn "commitWithOutbox\|server/api/lib" src .claude docs/adr` finds nothing outside ADR history lines

## Phase 9: A linked Expense sets a line item's Category

One feature commit: `feat(receipts): linked Expense sets a line item's Category`. Built by the TDD vertical-slice loop, in the order listed. Implements:
- adr025 for line items (`:41-52`)
- adr023, with `receipt_item` kept as part of its parent, in `receipts.*` files

### Changes

- **Pre-flight**:
  1. `make db_branch_delete`, then `make db_branch` (a fresh copy of prod).
  2. Count both:
     - `SELECT count(*) FROM "receipt_item" WHERE "expenseId" IS NOT NULL AND "categoryId" IS NOT NULL`
     - how many of those disagree with their Expense's Category

  Planning counted 0 (2026-10-07).
- **Migration**:
  1. **`make db_custom name=clear_linked_receipt_item_category`** → `0019`. It holds data only:

     ```sql
     -- Pre-flight (<date>): <n> linked line items held their own Category, <d> of
     -- them disagreeing with their Expense's. The Expense's Category wins.
     -- Rollback: not recoverable; restore from the Neon branch.
     UPDATE "receipt_item" SET "categoryId" = NULL WHERE "expenseId" IS NOT NULL;
     ```
  2. **`receipts.schema.ts`**:
     - import `check` and `sql`
     - add `check("receipt_item_expense_or_category_check", sql\`${t.expenseId} IS NULL OR ${t.categoryId} IS NULL\`)` to the extra-config (`:93`)
     - the `:79` comment becomes: "A linked item has no Category of its own (adr025). Deleting the Expense copies its Category here (trigger, 0017)."
  3. **`make db_generate`** → `0020`, holding only `ADD CONSTRAINT … CHECK`. Add a header: `-- Rollback: ALTER TABLE "receipt_item" DROP CONSTRAINT "receipt_item_expense_or_category_check";`
  4. **`make db_migrate`** on the branch. Verify:
     - the count is 0
     - writing both columns on one row fails with 23514
- **`receipts.schema.test.ts`**:
  - `getTableConfig(receiptItems).checks` has the constraint
  - the `:69` comment becomes "Linking and filing are set by the member…"
- **`ReceiptsRepository`**:
  - replace `setItemExpense` with `findItemLink(itemId): Promise<Pick<ReceiptItem, "expenseId" | "categoryId"> | undefined>` and `setItemLink(itemId, { expenseId, categoryId })`
  - add SQL snapshots
- **`ReceiptsService`**, as at `transactions.service.ts:34-39,122-168`:
  - **Link:** `setItemExpense(itemId, n)` → `setItemLink(itemId, { expenseId: n, categoryId: null })`.
  - **Unlink:** `setItemExpense(itemId, null)`:
    1. `findItemLink`. A miss → `NotFoundError("Receipt item not found.")`.
    2. If it was linked, copy `expenses.namesByIds([old]).get(old)?.categoryId ?? null`. Otherwise keep its own.
  - **`setItemCategory`** is unchanged in shape. A linked item trips the check.
  - **A local `rethrowItemWriteConflict`:**
    - `PgViolation.CheckViolation` → `ConflictError("A line item linked to an Expense takes its Category from the Expense.", { cause })`
    - anything else → `rethrowFkConflict(error, ITEM_FK_CONFLICT_MESSAGE)`
  - **`get`** makes two sequential calls:
    1. `expenses.namesByIds(expenseIds)`
    2. `categories.namesByIds` over the union of each unlinked item's `categoryId` and each linked Expense's `categoryId`

    `categoryName` is the effective Category's name.
- **`receipts.service.test.ts`** — one slice each:
  - linking clears `categoryId`
  - unlinking copies the Expense's Category
  - unlinking an unlinked item keeps its own
  - unlinking from a deleted Expense → `null`
  - unlinking a missing item → NotFound
  - CheckViolation → the `ConflictError` with `cause`
  - FK still → `ITEM_FK_CONFLICT_MESSAGE`
  - `get`:
    - a linked item shows its Expense's Category
    - an unlinked item shows its own
    - categories are looked up after expenses with the union, asserted on one shared call log
    - a missing id → `null`
- **`src/domain/receipts/`**:
  - `receipt.interface.ts:53` — `ReceiptItemDetail.categoryName` is the effective Category (the Expense's when linked, adr025)
  - `receipt.dto.ts:33` — "Both item writes are nullable…"
- **`receipt-detail.tsx`**:
  - **Copy:**
    - comment `:264-265` → "Linking and filing only make sense once…"
    - `onAttributed` → `onItemSaved` (`:276-281`)
    - header `:405` → "Link / file"
    - hint `:490-491` → "Confirm the matching transaction to link items to an expense or file them under a category."
  - **Category picker** (`:453-469`), while `item.expenseId !== null`:
    - `readOnly`, not `disabled`
    - shows the linked Expense's `categoryId` from the `expense.list` data
    - `aria-describedby` points at a per-row hint: "Set by the Expense. Choose No expense to edit."

    Unlinked, it shows `item.categoryId` with no hint.
- **Docs**:
  - `docs/adr/adr025-*.md:47` — drop "until step 7": a line item holds no Category while linked.
  - `:52` — note that line items shipped in step 7.

### Success

- [ ] `make check` passes. `make db_generate` after `0020` produces no file.
- [ ] `make test` passes
- [ ] `make build` passes
- [ ] On the branch, `make db_migrate` applies `0019` and `0020`, and the Phase 9 migration checks hold
- [ ] At https://personal-finance.localhost/receipts, on a matched receipt:
  - linking an item to an Expense locks its Category picker to that Expense's Category, with the hint
  - choosing "No expense" keeps that Category, and it can then be changed
  - moving the Expense to another Category changes the item's shown Category
  - no line-item text says "attribute"
- [ ] `/design-review`: the receipt detail item table, linked and unlinked rows, at desktop and mobile widths

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md`
  - step 7 `:835-848`
  - service split `:242-250`
  - module files `:381-404`
  - email write `:567-574`
  - linked Expense `:721-748`
  - testing `:796-798`
  - docs `:867-868`
- ADRs:
  - `docs/adr/adr021-*.md` (Proposed) — implemented by Phase 4 (tRPC controller), Phase 5 (`receipts.http.controller.ts`) and Phase 8 (shim retired)
  - `docs/adr/adr022-*.md` (Proposed) — implemented by Phase 3 (worker category read), Phase 4 (batched lookups), Phase 5 (routes without data access), Phase 6 (email write), Phase 7 (email reads the allowlist through its service) and Phase 8 (one write door)
  - `docs/adr/adr023-*.md` (Proposed) — implemented by Phase 3 (flat module files), Phase 7 (allowed senders become their own domain) and Phase 9 (`receipt_item` stays part of parent)
  - `docs/adr/adr024-*.md` (Proposed) — implemented by Phase 3 (the worker reads through `CategoriesService`)
  - `docs/adr/adr025-*.md` (Proposed) — implemented by Phase 9
- Prior plan: `thoughts/plans/2026-10-07-trpc-3-tier-step-6-categories.md` (commit C is the Transactions half of adr025)
- Precedent commits: allowlist f2d8107 / 5d68c58 / 2a87771; cashflow c040b47 / 170d250 / 9c262b3; adr025 for Transactions 43185a2
- Related code:
  - `src/server/api/test-caller.ts:20-33`
  - `src/server/db/recording-db.fake.ts`
  - `src/test/fakes.ts`
  - `src/server/errors/`
  - `src/server/transactions/transactions.service.ts:122-168`
  - `src/app/(dashboard)/transactions/_components/transaction-form.tsx:96-122`
