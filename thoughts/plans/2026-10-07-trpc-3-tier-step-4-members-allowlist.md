---
date: 2026-10-07
design: thoughts/designs/2026-09-29-trpc-3-tier-migration.md
adrs: [adr021, adr022]
status: Ready to implement
---
# tRPC 3-tier migration, step 4: members, then the allowlist — Implementation Plan

## Context

Steps 1–3 shipped. `allowed-sender.ts` is still a plain router: it queries Drizzle through `ctx.db`, left-joins better-auth's `user` table for owner names, and throws `TRPCError` inline. This is migration step 4 of the design: "Members, then the allowlist." A new members service in `src/server/auth/` owns Member name reads (adr022). The allowlist then moves into `src/server/email/` as a sub-resource with its own `AllowedSenderService` (adr021). It gets names from the members service instead of a join. The member sees no change: every tRPC path, code and message stays the same.

## Current State

- **The allowlist router** (`src/server/api/routers/allowed-sender.ts`, 86 lines). Every procedure is `protectedProcedure` and reads `ctx.session.user.id`.
  - **`list`** (`:19-32`)
    - Selects every allowlist row, not just the caller's. The comment at `:17-18` explains why.
    - Left-joins `user` on `allowedSenders.userId = user.id` for `userName`, ordered by `email` asc (`:21-25`).
    - Adds `isOwn: row.userId === ctx.session.user.id` (`:26-30`).
  - **`add`** (`:37-58`)
    - Inserts `{ email: input.email, userId: ctx.session.user.id }` (`:42-45`). The owner comes from the session, never the input (`:34-36`).
    - A `UniqueViolation` → `TRPCError` `CONFLICT` "That address is already on the allowlist.", with the driver error as `cause` (`:46-56`). Any other error is rethrown, so it is a 500.
    - Returns through `assertRow(row, "add allowed sender")` (`:57`).
  - **`remove`** (`:64-85`)
    - Delete-or-404 in one statement (`:70-78`), filtered on `id` **and** `userId = ctx.session.user.id`. Another Member's id matches no row, so it 404s (`:67-69`).
    - No row → `TRPCError` `NOT_FOUND` "That address is not on your allowlist." with no `cause` (`:79-83`).
    - Returns `{ success: true }`.
  - It imports `user` from `~/server/auth/auth.schema` (`:13`), `allowedSenders` (`:14`), `drizzle-orm` (`:2`), and `assertRow` / `isPgViolation` through the `src/server/api/lib/` re-exports (`:10-11`).
- **Its test** (`src/server/api/routers/allowed-sender.test.ts`, 145 lines)
  - Still mocks `~/server/db` and `~/server/auth` (`:7-8`).
  - Uses hand-rolled `insertDb` / `deleteDb` fakes (`:26-52`) and session id `"user-1"` (`:13`).
  - Covers `add` (`:62-114`) and `remove` (`:116-145`), including the ownership WHERE (`:136-144`).
  - `list` has no test.
- **Schema and kernel**
  - `src/server/email/allowed-sender.schema.ts:4-27`. The `userId` FK to `user.id` cascades on delete (`:11-16`). There is a unique index on `email` (`:24`).
  - `AllowedSender` and `AllowedSenderListItem` are in `src/domain/email/allowed-sender.interface.ts:3-19`. `userName: string | null` (`:14`) is null only when the left join finds no `user` row, because `user.name` is not null (`src/server/auth/auth.schema.ts:8`).
  - The DTOs are in `src/domain/email/allowed-sender.dto.ts:6-14`. `allowedSenderCreateDto` trims and lower-cases.
  - The barrel is `src/domain/email/index.ts:1-21`.
- **`src/server/auth/`** holds better-auth's `auth.schema.ts` (`user` at `:6-20`), `config.ts`, `index.ts:1` (re-exports `auth` from `config`, which loads env), `server.ts` and `client.ts`.
  - It has no service or repository yet.
  - `src/domain/` has no `auth` or `members` folder, so there is no kernel to mirror.
- **Other `user` readers**
  - `src/server/api/routers/receipts.ts:34,97,101` joins `user.name`. That is step 7.
  - `DrizzleEmailRepository.findAllowedSender` (`src/server/email/email.repository.ts:47-56`) reads `allowedSenders` for the webhook. It is the same domain, so it breaks no rule.
- **Wiring**
  - `src/server/api/services.ts:13-34` builds `balances`, `expenses`, `income`, `settings` and `transactions`. `expenses` is a local const shared with `transactions` (`:13-15,30-33`).
  - `src/server/api/root.ts:1` imports `allowedSenderRouter` from `routers/`, under the key `allowedSender` (`:14`).
  - Nothing else imports it (`git grep "routers/allowed-sender"`).
- **The architecture to-do list** (`src/server/architecture.test.ts:38-58`) has 19 entries. This step owns 3, all rule 3, at `:41-43`:
  - `routers/allowed-sender.ts` → `drizzle-orm`
  - → `~/server/auth/auth.schema`
  - → `~/server/email/allowed-sender.schema`
- **Docs**
  - `.claude/rules/server-architecture.md:142-146` lists the unmigrated routers (`allowedSender, cashflow, receipt`).
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:80` (Done) and `:81` (Next: "members, then the allowlist (step 4)") track progress.
- **Precedents to mirror**
  - Tiers:
    - `src/server/settings/settings.repository.ts:18-27`: deps `{ db: typeof realDb }`, with a type-only `db` import (`:2`).
    - `src/server/income/income.service.ts:9-18`.
    - `src/server/settings/settings.trpc.controller.ts`.
  - Batched lookup:
    - `ExpensesService.namesByIds` (`src/server/expenses/expenses.service.ts:117-134`): empty ids skip the query (`:127-128`).
    - `findExpenseNames` (`src/server/expenses/expenses.repository.ts:189-194`).
    - The merge in `TransactionsService.list` (`src/server/transactions/transactions.service.ts:47-61`), with `distinctLinks` / `nameOf` (`:26-31`).
  - Errors:
    - `ConflictError` and `NotFoundError` (`src/server/errors/domain-errors.ts:4,11`).
    - `isPgViolation` (`src/server/errors/parse-error.ts:72`).
    - `assertRow` (`src/server/errors/assert-row.ts:3-6`).
    - The service catch shape in the design (`:471-486`).
  - Tests:
    - `harness` (`src/server/settings/settings.repository.test.ts:9-15`), with `COLUMNS` / `rowOf` and fake timers (`src/server/income/income.repository.test.ts:22-25`).
    - `serviceWith` (`src/server/settings/settings.service.test.ts:12-19`).
    - `callerWith` (`src/server/settings/settings.trpc.controller.test.ts:8-12`).
    - Domain-error mapping (`src/server/expenses/categories.trpc.controller.test.ts:75`).
  - Helpers:
    - `recordingDb`, `rowOf`, `pgError` (`src/server/db/recording-db.fake.ts:18-70`).
    - `recorder`, `throwing`, `unstaged`, `failedQuery`, `expectPlainError` (`src/test/fakes.ts:9-39`).
    - `createTestCaller`, whose session defaults to `member-1` (`src/server/api/test-caller.ts:20-33`).
  - Commit shape: step 3's characterize → serve → remove (`fd6eca7`, `1f5b8fe`, `1e3cb81`).
- **Glossary** (`CONTEXT.md`):
  - **Member** (`:43-45`).
  - **Allowed Sender** (`:48-49`).
  - "user" means **Member** (`:214-217`).
- **Client callers.** None of these change:
  - `src/app/(dashboard)/settings/page.tsx:7`
  - `src/app/(dashboard)/settings/_components/allowed-senders-section.tsx:20,30,38`. It reads `userName` (`:129`) and `isOwn` (`:139`).

## Desired End State

- **Each path is served by a controller over its own service and repository:**

  | Path | Controller | Service | Repository |
  | --- | --- | --- | --- |
  | `allowedSender.*` | `src/server/email/allowed-sender.trpc.controller.ts` | `AllowedSenderService` | `AllowedSenderRepository` / `DrizzleAllowedSenderRepository` |
  | none | none | `MembersService` (`src/server/auth/members.service.ts`) | `MembersRepository` / `DrizzleMembersRepository` |
- **`services.ts` builds `allowedSenders`.** `members` is a local const passed into it. It is not on `ctx.services`, because no controller calls it.
- **The allowlist makes no join.**
  - `AllowedSenderService.list` makes one `MembersService.namesByIds` call per request and merges in memory.
  - An id with no `user` row gives `userName: null`, as the left join did.
- **Every service method that reads the session takes `memberId`**: `list`, `add` and `remove`. The `userId` column and the `AllowedSender` fields keep better-auth's name. The repository maps between them.
- **`src/server/api/routers/allowed-sender.ts` and its test are gone.** `routers/` holds only the `cashflow` and `receipts` files.
- **The to-do list has 16 entries.** No new entry was added.
- **Every tRPC path, code and message matches today's:**
  - `add` on a duplicate is still `CONFLICT` "That address is already on the allowlist.".
  - `add` with an empty `returning` is still `INTERNAL_SERVER_ERROR` "Failed to add allowed sender.".
  - `remove` on a missing id, or another Member's id, is still `NOT_FOUND` "That address is not on your allowlist.".
- `make check`, `make test` and `make build` are green.

## Out of Scope

- **The webhook's sender lookup.** `EmailRepository.findAllowedSender` (`email.repository.ts:47-56`) stays. `EmailService` keeps webhook ingest (design `:252-254`). The allowlist tiers do not take it over.
- **The receipts router's `user.name` join** (`receipts.ts:34,97,101`). Step 7 moves it onto `MembersService` and adds `members.module.ts`.
- **`members` on `ctx.services`.** No controller calls it.
- **Renaming `userId` / `userName`** in `AllowedSender`, `AllowedSenderListItem` or the column. That would change the response shape. Only the service boundary says `memberId`.
- **The email write** (`createPendingReceipts`, `email.repository.ts:62-89`). That is step 7.
- **Steps 5–8:** cashflow, categories, receipts, `*.module.ts` files, deleting `src/server/api/lib/`, and removing `ctx.db`.
- **Any tRPC path, response shape or client change.**
- **Changing adr021 or adr022 `Status:`.** Both stay Proposed.

## Approach

Two changes, in the design's order.

1. **Members.** This is new code with no caller yet, so it needs no characterization. Build it by the TDD vertical-slice loop (`tdd` skill): one repository test, then its implementation, then one service test, then its implementation.
2. **The allowlist**, in step 3's three commits:
   - **Characterize.** Pin the old router's SQL, params, results, codes and messages through `recordingDb`.
   - **Serve (Commit A).** Add the three tiers, point the characterization test at the new controller, and wire `members` in.
   - **Remove (Commit B).** Delete the router and its test, clear the 3 to-do entries and update the docs.

The join cannot be lifted verbatim. A repository in `email/` importing `auth.schema` breaks rule 1, and the to-do list only shrinks. So Commit A replaces the join right away.

- **The proof.** The only snapshot that changes is the main `list` case's SQL. One joined select becomes a plain `allowed_sender` select plus a `user` name select. Every result, code and message assertion stays byte-identical.
- **The cost.** Names now come from a second read, as for the transaction list in step 2. The design accepts this (§ Replacing a join).

## Phase 1: Members

One commit.

### Changes

- **New `src/server/auth/members.repository.ts`**
  - `export interface MemberNameRow { id: string; name: string }`, like `NameRow` (`expenses.repository.ts:14-17`).
  - `interface MembersRepository { findNames(memberIds: string[]): Promise<MemberNameRow[]> }`.
  - `class DrizzleMembersRepository`, with `interface DrizzleMembersRepositoryDeps { db: typeof realDb }` as in `settings.repository.ts:18-27`.
  - `findNames` selects `{ id: user.id, name: user.name }` from `user` where `inArray(user.id, memberIds)`, as `findExpenseNames` does (`expenses.repository.ts:189-194`).
  - Imports only `./auth.schema` and a type-only `~/server/db`. Never `~/server/auth` (`index.ts:1`), which loads `config.ts` and env.
  - Comment: reads only. better-auth owns every write to `user` (adr022 `:74`).
- **New `src/server/auth/members.repository.test.ts`.** Uses the `harness` from `settings.repository.test.ts:9-15`.
  - `findNames(["member-1", "member-2"])` pins the SQL and params in `toMatchInlineSnapshot` (`select "id", "name" from "user" where "user"."id" in ($1, $2)`) and returns the staged rows as `MemberNameRow`s.
  - A driver error bubbles unchanged.
- **New `src/server/auth/members.service.ts`**
  - `MembersService`, with `interface MembersServiceDeps { repository: MembersRepository }`.
  - `namesByIds(memberIds: string[]): Promise<ReadonlyMap<string, string>>`. Empty ids give an empty map and skip the query, as in `expenses.service.ts:127-128`.
  - Comment: the batched lookup that replaces a cross-domain join (adr022). One call per request, never per row. The class takes the glossary name Member, not the library's table name (design `:561-565`).
- **New `src/server/auth/members.service.test.ts`.** Uses `serviceWith` with `unstaged` defaults, as in `settings.service.test.ts:12-19`.
  - The repository's rows become a map from id to name.
  - An id with no row has no entry.
  - Empty ids → an empty map, and `findNames` is never called. The `unstaged` default would throw if it were.
  - The ids are passed to the repository unchanged.

### Success

- [x] `make check` passes
- [x] `make test` passes. `architecture.test.ts` is green with no new to-do entry, because `members.repository.ts` imports its own domain's schema.
- [x] `make build` passes
- [x] `git grep -n -E "from \"~/server/auth\"|server/auth/config" src/server/auth/members.repository.ts src/server/auth/members.service.ts` returns nothing
- [x] `/security-review` (the phase adds files under `**/auth/**`)

## Phase 2: Allowlist

One change, three commits.

### Changes

**Commit 1: characterize**

- **Rewrite `src/server/api/routers/allowed-sender.test.ts` onto the `recordingDb` harness.** Mirror step 3's `setting.test.ts` (`fd6eca7`).
  - **Harness.**
    - `createCallerFactory(createTRPCRouter({ allowedSender: allowedSenderRouter }))({ db, session, services: {}, headers: new Headers() } as never)`.
    - Session defaults to `{ user: { id: "member-1" } }`, matching `createTestCaller`'s default, so the Commit A switch leaves the params alone. `null` means signed out.
    - `db` comes from `recordingDb(respond)`. `respond` matches on `query.sql`.
  - **Remove the old scaffolding:**
    - the `vi.mock` calls (`:7-8`) and dynamic imports (`:10-11`)
    - `insertDb`, `deleteDb` and the local `pgError` (`:26-60`). Use `pgError` from `recording-db.fake.ts:68-70`.
  - **Fixtures.**
    - `rowOf` keyed on `Object.keys(getTableColumns(allowedSenders))`, plus `"userName"` for the join row.
    - Fake timers pin `createdAt`, as in `income.repository.test.ts:22-23`.
  - **What each case pins.** SQL and params go in `toMatchInlineSnapshot`. Codes and messages use `toMatchObject`.
  - **`list`:**
    - The join SQL: `left join "user"` on the `userId`, ordered by `"allowed_sender"."email"` asc.
    - Two staged rows, one owned by `member-1` ("Sam") and one by `member-2` ("Alex"), come back in staged order. `isOwn` is `true` for the first and `false` for the second, and each has its `userName`.
    - A row whose `user` is missing → `userName: null`. Results only, no SQL snapshot.
    - An empty allowlist → `[]`, with `queries` of length 1. Count only, no SQL snapshot.
  - **`add`:**
    - `"  Sam@Example.COM  "` → the insert SQL and params: `"sam@example.com"`, `"member-1"`, the pinned `createdAt`.
    - Returns the stored row.
    - `pgError("23505")` → `CONFLICT` "That address is already on the allowlist.".
    - `pgError("23503")` → `INTERNAL_SERVER_ERROR`.
    - Empty `returning` → `INTERNAL_SERVER_ERROR` "Failed to add allowed sender.".
    - `"not-an-email"` → `BAD_REQUEST` with zero queries.
  - **`remove`:**
    - The delete SQL and params, `[1, "member-1"]`, with `returning "id"`. It resolves `{ success: true }`.
    - Keep the case name "scopes the delete to the caller's own entries" and its comment (`:133-135`). The snapshot now carries that contract.
    - No row → `NOT_FOUND` "That address is not on your allowlist.".
  - **Signed out.** `UNAUTHORIZED` with zero queries, for all three procedures.

**Commit A: serve through the tiers**

- **New `src/server/email/allowed-sender.repository.ts`:** `interface AllowedSenderRepository` + `class DrizzleAllowedSenderRepository`.
  - Same deps shape as `settings.repository.ts:18-27`.
  - Touches only `allowedSenders`. No try/catch, no logging.
  - Takes `memberId` and writes or filters the `userId` column (design `:355-356`).

  | Method | Lifted from |
  | --- | --- |
  | `list(): Promise<AllowedSender[]>` | `allowed-sender.ts:21-25`, with no join and no `userName`. `select().from(allowedSenders).orderBy(asc(allowedSenders.email))` |
  | `insert(memberId, email): Promise<AllowedSender \| undefined>` | `:42-45` |
  | `deleteOwn(memberId, id): Promise<{ id: number } \| undefined>` | `:70-78`. JSDoc: `` `undefined` when no row matched — absent or another Member's. `` Keep the one-statement comment from `:67-69`. |
- **New `src/server/email/allowed-sender.repository.test.ts`.** Uses the `harness` from `settings.repository.test.ts:9-15`, with the same fake timers.
  - `insert` and `deleteOwn` copy Commit 1's `add` and `remove` snapshots unchanged.
  - `list` pins the new plain select ordered by `email` asc.
  - A driver error from `insert` bubbles unchanged (`pgError("23505")`).
- **New `src/server/email/allowed-sender.service.ts`:** `AllowedSenderService`.
  - Deps: `interface AllowedSenderServiceDeps { repository: AllowedSenderRepository; members: Pick<MembersService, "namesByIds"> }`.
    - `MembersService` is a type-only import from `~/server/auth/members.service`.
    - The port is a `Pick`, as in `transactions.service.ts:35`.
  - **`list(memberId): Promise<AllowedSenderListItem[]>`**
    - Reads `repository.list()`.
    - Then makes one `members.namesByIds` call with the distinct `userId`s. Skip the call when there are no rows.
    - Maps each row to `{ ...row, userName: names.get(row.userId) ?? null, isOwn: row.userId === memberId }`.
    - Move the household-wide comment from `allowed-sender.ts:17-18` and the `isOwn` comment from `:26` here (design `:357-358`).
  - **`add(memberId, email): Promise<AllowedSender>`.** The design's shape (`:471-486`):
    - A `UniqueViolation` → `ConflictError("That address is already on the allowlist.", { cause: error })`.
    - Anything else is rethrown.
    - Then `assertRow(row, "add allowed sender")`.
    - Move the comment from `:47-48`.
  - **`remove(memberId, id): Promise<void>`**
    - `deleteOwn` gives `undefined` → `NotFoundError("That address is not on your allowlist.")`.
    - Move the blast-radius comment from `:60-63`.
  - Imports from `~/server/errors/`, not `~/server/api/lib/`.
- **New `src/server/email/allowed-sender.service.test.ts`.** Uses `serviceWith(repository, members)` with `unstaged` defaults for both fakes.
  - **`list`**
    - Merges names.
    - `isOwn` follows the given `memberId`, not a fixed id.
    - An owner missing from the map → `userName: null`.
    - Two rows with one owner → one `namesByIds` call, with that id once.
    - No rows → `[]`, and `namesByIds` is never called.
  - **`add`**
    - Hands the repository the member id and email, and returns its row.
    - `failedQuery("23505")` → a `ConflictError` with the message, whose `cause` is the thrown error.
    - `failedQuery("23503")` propagates as the same reference.
    - An empty `insert` → `expectPlainError(…, "Failed to add allowed sender.")`.
  - **`remove`**
    - Hands the repository the member id and id.
    - A row → resolves.
    - `undefined` → a `NotFoundError` with the message.
- **New `src/server/email/allowed-sender.trpc.controller.ts`:** `export const allowedSenderRouter = createTRPCRouter({ … })`.
  - The procedures:
    - `list` → `ctx.services.allowedSenders.list(ctx.session.user.id)`
    - `add` → `ctx.services.allowedSenders.add(ctx.session.user.id, input.email)`, with `allowedSenderCreateDto`
    - `remove` awaits `ctx.services.allowedSenders.remove(ctx.session.user.id, input.id)` with `allowedSenderRefDto`, then returns `{ success: true }`. Shape as in design `:205-212`.
  - Keep the server-set-owner comment from `:34-36` on `add`.
  - No Drizzle, no try/catch, no `TRPCError`.
- **New `src/server/email/allowed-sender.trpc.controller.test.ts`.** `callerWith(allowedSenders, session?)` as in `settings.trpc.controller.test.ts:8-12`, with `recorder` fakes.
  - `list` passes the session's member id and returns the service's items.
  - `add` passes the session's member id and the parsed email. `"  Sam@Example.COM  "` arrives as `"sam@example.com"`.
  - **The security case (design `:779-783`).** With session `{ user: { id: "member-2" } }`, `remove({ id: 1 })` calls the service with `["member-2", 1]`. The member id comes only from the session. The type checker cannot catch a wrong id here.
  - `remove` returns `{ success: true }`.
  - **Through the real middleware** (`categories.trpc.controller.test.ts:75`):
    - A `throwing(new ConflictError(…))` → `CONFLICT` with the message.
    - A `throwing(new NotFoundError(…))` → `NOT_FOUND` with the message.
  - `"not-an-email"` → `BAD_REQUEST`, and the fake is never called.
  - Signed out → `UNAUTHORIZED` for all three, and no fake is called.
- **`src/server/api/services.ts`**
  - Add a local `const members = new MembersService({ repository: new DrizzleMembersRepository({ db }) })` beside `expenses` (`:13-15`). Comment: no controller calls it, so it stays off `services`.
  - Add `allowedSenders: new AllowedSenderService({ repository: new DrizzleAllowedSenderRepository({ db }), members })`.
- `src/server/api/root.ts:1` — import `allowedSenderRouter` from `~/server/email/allowed-sender.trpc.controller`. The key (`:14`) does not change.
- **The proof.** Point `routers/allowed-sender.test.ts` at the new router through `createTestCaller`, as `1f5b8fe` did for settings.
  - `services: { allowedSenders: new AllowedSenderService({ repository: new DrizzleAllowedSenderRepository({ db: db as never }), members: new MembersService({ repository: new DrizzleMembersRepository({ db: db as never }) }) }) }`, all on one `recordingDb`, with no `ctx.db`.
  - `respond` gains a branch for the `"user"` name select. It returns `[id, name]` rows, and drops the joined `userName` column from the `allowed_sender` rows.
  - **The one intended snapshot diff.** The main `list` case's SQL goes from one joined select to two queries: the plain `allowed_sender` select, then `select "id", "name" from "user" where "user"."id" in (…)`.
  - Every other snapshot, and every result, code and message assertion, stays byte-identical. That includes the empty-list case's single query.

**Commit B: remove the router, update the docs**

- **Delete `src/server/api/routers/allowed-sender.ts` and `allowed-sender.test.ts`.** The cases now live elsewhere:
  - SQL goes to `allowed-sender.repository.test.ts` and `members.repository.test.ts`.
  - Messages, `isOwn` and names go to `allowed-sender.service.test.ts`.
  - Auth, input and the session-id security case go to `allowed-sender.trpc.controller.test.ts`.
- **`src/server/architecture.test.ts` to-do list.** Delete the 3 `routers/allowed-sender.ts` entries (`:41-43`). The list goes from 19 to 16.
- **`.claude/rules/server-architecture.md:142-146`.** The list becomes `cashflow, receipt`. Add that `allowedSender` comes from `src/server/email/`.
- **`docs/adr/adr004-domain-oriented-3-tier-server-architecture.md`:**
  - "Done" (`:80`) adds two entries:
    - `src/server/auth/`: `MembersService` → `MembersRepository` / `DrizzleMembersRepository`, a read-only name lookup over better-auth's `user` table.
    - `src/server/email/`: `allowed-sender.trpc.controller.ts` → `AllowedSenderService` → `AllowedSenderRepository` / `DrizzleAllowedSenderRepository`. Owner names come through `MembersService.namesByIds`, not a join.
  - "Next" (`:81`) becomes cashflow (step 5), then categories (step 6). `receipts.ts` stays last (step 7), when the bound `commitWithOutbox` shim retires.
- `docs/adr/adr021-trpc-router-is-the-controller-tier.md` — implements this decision for the allowlist, as a sub-resource with its own service.
- `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` — implements its member-names ownership move (`:51`) and clears `routers/allowed-sender.ts`'s rule-3 entries.

### Success

- [x] `make check` passes
- [x] `make test` passes. Commit 1 is green against the unchanged `allowed-sender.ts`. In Commit A, only the main `list` SQL snapshot changes.
- [x] `make build` passes
- [x] `git grep -n -E "drizzle-orm|TRPCError|ctx\.db|auth\.schema" src/server/email/allowed-sender.service.ts src/server/email/allowed-sender.trpc.controller.ts` returns nothing
- [x] `git grep -n "auth.schema" src/server/email/allowed-sender.repository.ts` returns nothing
- [x] `src/server/api/routers/` holds only `cashflow` and `receipts` files, and the to-do list has 16 entries
- [x] Every path named in the edited rules-file section exists (`git ls-files` check)
- [x] `/security-review` (the own-entries-only `remove` rule moves tiers)
- [x] At https://personal-finance.localhost, the Settings page allowlist behaves as before:
  - it lists every Member's addresses in email order, each with "Files to <name>"
  - only your own rows offer a remove button (dev DB holds only own rows; other-Member `isOwn: false` is pinned by the service test)
  - adding a new address works, and re-adding it shows "That address is already on the allowlist."
  - an invalid address shows the form error
  - removing your own address works

## References

- Design doc: `thoughts/designs/2026-09-29-trpc-3-tier-migration.md`. It carries `## Related ADRs`. Relevant sections:
  - § Migration step 4 (`:815`)
  - § Service split rule, Email (`:252-254`)
  - § Domain hierarchy, sub-resource (`:265`) and `auth/` (`:278-279`)
  - § Router map (`:292,294`)
  - § Dependency graph (`:309-315`)
  - § tRPC composition root, `memberId` and `isOwn` (`:351-358`)
  - § Who does what (`:463-489`)
  - § Member names (`:561-565`)
  - § Testing (`:779-783`)
- ADRs:
  - `docs/adr/adr021-trpc-router-is-the-controller-tier.md` (Proposed) — implemented by Phase 2
  - `docs/adr/adr022-cross-domain-data-through-the-owning-service.md` (Proposed) — implemented by Phase 1 (the members service owns Member name reads) and Phase 2 (the join becomes a batched lookup, and 3 rule-3 entries clear)
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted) — its Implementation status is updated in Phase 2
  - adr023, adr024 and adr025 (Proposed) are not this step. Steps 6 and 7 implement them.
- Prior plans:
  - `thoughts/plans/2026-10-02-trpc-3-tier-step-2-expenses-categories.md` (a join swapped for a batched lookup)
  - `thoughts/plans/2026-10-06-trpc-3-tier-step-3-income-balances-settings.md` (the characterize → serve → remove shape)
- Rules: `.claude/rules/server-architecture.md`, `.claude/rules/unit-testing.md`
- Glossary: `CONTEXT.md`, **Member** (`:43-45`), **Allowed Sender** (`:48-49`), "user" means Member (`:214-217`)
- Related:
  - `src/server/api/routers/allowed-sender.ts:16-86` and `allowed-sender.test.ts` (deleted in Phase 2)
  - `src/server/email/allowed-sender.schema.ts:4-27`, `src/domain/email/allowed-sender.interface.ts:3-19`
  - `src/server/auth/auth.schema.ts:6-20`
  - `src/server/api/routers/receipts.ts:34,97,101` (step 7)
  - `src/server/api/services.ts:13-34`, `src/server/api/root.ts:1,14`
  - `src/server/architecture.test.ts:38-58`
