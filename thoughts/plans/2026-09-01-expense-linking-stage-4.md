# Expense Linking Stage 4 — Outbox + Inngest Rails Implementation Plan

## Context

Stage 4 of the 2026-08-16 expense-linking/receipts/cashflow design (Build order item 4, `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md:144`): the **async platform** — an `outbox` table plus Inngest client/registry/route-handler and the `outbox-sweep`/`outbox-prune` crons — that later stages (receipts upload/email, CDR/PayPal sync) all ride. This is the **first real implementation of adr002/adr003** (`docs/adr/adr002-canonical-postgres-store-transactional-outbox.md`). Stage 4 builds the **rails only**: there is no event producer or worker yet — the first producer (`receipt/uploaded`) and its worker land in stage 5.

**One deviation from the design as originally written, decided in the stage-4 planning session and confirmed by the decider (Sam):** the write path is built on the current **`postgres-js` interactive `db.transaction()`**, *not* the `neon-http` `db.batch()` the design originally specified (`:83`, now updated to match). `db.transaction()` already satisfies adr002 clause 2's atomicity requirement, so no driver swap is needed to build the outbox. **adr003 was revised in place** (`docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md`, Accepted 2026-09-01) to make this the decision of record: keep `postgres-js` + `db.transaction()`, defer the `neon-http`/`db.batch()` swap until a connection/scale trigger fires; both existing interactive-tx sites port cleanly to `db.batch()` if it ever is. No new ADR — the decision lives in adr003 itself.

## Current State

- **Driver is `postgres-js`, not `neon-http`.** `src/server/db/index.ts:1-2,32-35` builds `drizzle(postgres(env.DATABASE_URL))` with a `globalThis` HMR connection cache. `db.transaction(async tx => …)` interactive transactions work today and are used in two places — `category.update` (`src/server/api/routers/category.ts:94`) and `category.reorder` (`:125`). `db.batch()` (neon-http-only) is used nowhere. **Neither `category` site needs statement-to-statement data flow** (both build their statements up front), so both are batch-expressible later; nothing here blocks a future adr003 swap.
- **No Inngest, no outbox.** `inngest` is not a dependency (`package.json`); there is no `src/server/inngest/`, no `src/server/outbox/`, no `outbox` table, and no cron infrastructure (no `vercel.json` — Inngest owns its own schedules). Confirmed by adr002's own implementation-status note (`adr002:102-109`).
- **The `.claude/rules/server-architecture.md` 3-tier architecture is largely inherited fiction.** It describes domains (leads/hubspot/messaging/twilio) and a repository/service/module ceremony that **do not exist in this repo** — flagged already in the stage-3 plan (`thoughts/plans/2026-09-01-expense-linking-stage-3.md:36`) and governed by adr012 (feature/infra work stays plain). Its *outbox/inngest file layout* (`src/server/outbox/commit.ts`, `src/server/outbox/index.ts` `publish`, `src/server/inngest/events.ts` `EVENT_REGISTRY`, `src/server/inngest/functions.ts`, `src/server/inngest/registry-golden.test.ts`) **matches adr002 clause 7 and adr005** and is followed here; its *3-tier repository/service/module tiers* are **not** built (adr012, design `:89`). Reconciling the rule text itself is out of scope (see Out of Scope).
- **Router/schema/DTO conventions** (plain-router, adr012): routers in `src/server/api/routers/*.ts` use `protectedProcedure` + `ctx.db`, registered in `src/server/api/root.ts:15-23`; per-domain Drizzle tables in `src/server/<domain>/<domain>.schema.ts` discovered by the `./src/server/**/*.schema.ts` glob (`drizzle.config.ts:6`) and spread-merged in `src/server/db/index.ts:13-22`; enums are TS string enums in `src/lib/constants.ts` bridged via `pgEnum(Object.values(Enum) as [...])` (`src/server/income/income.schema.ts:4-7`).
- **tRPC context** exposes `{ db, session, headers }` (`src/server/api/trpc.ts:29-38`); there is no Inngest client in context yet. Transformer is superjson (`:48`).
- **Migrations** are two-step `make db_generate` → `make db_migrate` (**apply is user-run**), never `drizzle-kit push` (`.claude/rules/database-migrations.md`). Latest migration is `drizzle/0004_balance_snapshot.sql`; **next is `0005`**. On `main` `DATABASE_URL` is production — do all migration/write work on a **stage-4 feature branch** (memory: main-branch-db-is-production).
- **Test conventions:** Vitest, `src/**/*.test.ts` (`vitest.config.ts`), `make test` = `vitest run`. Existing tests are pure/schema/DTO only — **no router-integration tests hit a live DB**; schema tests use `getTableColumns` (`src/server/income/income.schema.test.ts`), DTO tests use the type helpers `Expect`/`Equal`/`WritesInto` in `src/test/type-contracts.ts`. New async-machinery tests must therefore use **injected fakes**, not a real DB/Inngest (design `:136`: "workers via `makeRun*(fakeDeps)` — no Inngest in tests").
- **Glossary** (`CONTEXT.md`) fixes **Provenance** (Transaction column, `:83,154`) and **Channel** (Receipt column) — neither is touched in stage 4. No outbox/event terminology is defined yet; this plan introduces "outbox", "sweep", "prune", "event registry" per adr002.
- **Migration→Inngest trigger idiom already documented:** `.claude/rules/database-migrations.md` says a SQL migration triggers a workflow by `INSERT`-ing an `outbox` row (not a JS `inngest.send`), delivered at-least-once by `outbox-sweep`. This is the manual smoke path for Phase 3.

## Desired End State

- An `outbox` table (adr002 shape: `uuid` PK, `event_name`, `payload jsonb`, `created_at`, `processed_at`, `attempts`, `last_error`, partial unprocessed index) in one applied, git-tracked migration `0005`.
- A typed Inngest surface: `src/server/inngest/events.ts` `EVENT_REGISTRY` (Zod, the single event-name + payload authority, adr002 clause 7), a typed `src/server/inngest/client.ts`, and `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` env.
- Write-path primitives `commitWithOutbox(writes, events)` and `publish(event)` in `src/server/outbox/`, executing the canonical writes + outbox insert in **one `db.transaction()`**, then a **best-effort post-commit `inngest.send`** (stamp `processed_at` on success; bump `attempts`/`last_error` and swallow on failure — adr002 clause 3). Unit-tested with injected fakes; **first real caller is stage 5** (ships tested-but-unwired).
- Two Inngest cron functions — `outbox-sweep` (`0 * * * *`, 30-second row-age floor, outbox row `id` = Inngest idempotency key; adr002 clauses 4–5) and `outbox-prune` (`0 3 * * *`, deletes `processed_at < now() - 7 days`; **never** touches unacked or stuck rows) — served from `src/app/api/inngest/route.ts`.
- A golden test pinning the **frozen** external identifiers: `EVENT_REGISTRY` keys and function ids (`outbox-sweep`, `outbox-prune`).
- **adr003 revised in place** (Accepted, 2026-09-01): decision flipped to keep `postgres-js` + `db.transaction()` and defer the `neon-http`/`db.batch()` swap. No new ADR.
- **No** driver swap, **no** `category.ts` rewrite, **no** `transaction` uuid-PK migration, **no** new tRPC router, **no** UI.

## Out of Scope

- **The neon-http driver swap (adr003) and any `transaction` uuid-PK migration.** Deferred via the revised adr003; `db.batch()` is not introduced. Revisit on any of adr003's three triggers: connection-limit errors despite the pooled endpoint, measurable scale-to-zero cost, or the stage-7 import pipeline forcing the uuid-PK migration.
- **Any event producer or worker beyond the two crons.** No `receipt/uploaded` emit, no `process-receipt` worker, no receipt/email/blob/AI code — stages 5–6. Stage 4 seeds the receipt **event names** in the registry (frozen wire strings) with provisional payload schemas; their consumers and any payload firming-up land in stage 5.
- **Rewriting `.claude/rules/server-architecture.md`.** Its 3-tier repository/service/module prescription is inherited fiction (adr012; stage-3 plan `:36`); this plan neither follows nor rewrites it. Flag for a separate rules-reconciliation pass (memory: delete-stale-rules-dont-rewrite — offer deletion, don't silently patch).
- Household scoping (`householdId`), a settings UI, an observability/alerting backend for stuck rows (adr002's TBD runbook stays TBD).

## Approach

Three vertical slices in plain-helper style (adr012; no repository/service/module tier), each shipping alone, in dependency order: **Phase 1** stands up the typed Inngest surface (client + registry + env) that everything else imports; **Phase 2** adds the `outbox` table and the `commitWithOutbox`/`publish` write door on `db.transaction()`, plus the in-place adr003 revision recording the deferral; **Phase 3** adds the two cron workers and the serve route handler that make the rail run end-to-end. Testing follows the design's shape: the registry and the pure worker/commit cores are exercised with **injected fakes** (no live Inngest/DB in `make test`), the frozen identifiers are pinned by a golden test, and the rail's real delivery is a **manual Inngest-Dev-Server smoke**. Terminology per adr002: **outbox**, **event registry**, **sweep**, **prune**, **idempotency key**.

## Phase 1: Inngest surface — client + event registry + env

Stands up the typed Inngest client and the `EVENT_REGISTRY` naming authority. No functions are served yet (the crons and route handler are Phase 3), so nothing runs — this phase makes the client importable and the event types real.

> **Library API (installed `inngest@4.18.1`):** v4 **removed** `EventSchemas().fromZod()` and the client `schemas` option — event typing moved onto per-function triggers, so the client is a bare `new Inngest({ id, eventKey })` and `EVENT_REGISTRY` stays the naming/payload authority with validation at the `buildOutboxEvent` mint boundary (memory: inngest-v4-dropped-eventschemas). `inngest.send` takes a top-level `id` as the idempotency key (dedup window **24h**). Client `id` is a required hyphenated slug; `eventKey` auto-reads `INNGEST_EVENT_KEY`.

### Changes

- `package.json` — add `inngest` (latest stable) via `make install` / `yarn add inngest`.
- `src/env.js` — add two **server** vars, required in prod, optional in dev (the Inngest Dev Server needs neither), mirroring the `requiredInProd` pattern (`src/env.js:5-6,47-48`): `INNGEST_EVENT_KEY: requiredInProd(z.string())`, `INNGEST_SIGNING_KEY: requiredInProd(z.string())`; add both to `runtimeEnv` (`:67-76`).
- `src/server/inngest/events.ts` — **new**, the single event authority (adr002 clause 7):
  ```ts
  export const EVENT_REGISTRY = {
    "receipt/uploaded": z.object({ receiptId: z.string() }),
    "receipt/email.received": z.object({ receiptId: z.string() }),
    "receipt/retry": z.object({ receiptId: z.string() }),
  } as const;
  export type EventName = keyof typeof EVENT_REGISTRY;
  export type EventPayload<K extends EventName> = z.infer<(typeof EVENT_REGISTRY)[K]>;
  export interface OutboxEventDescriptor { id: string; name: EventName; data: unknown }
  // mints the uuid idempotency key + parses payload against the registry
  export function buildOutboxEvent<K extends EventName>(name: K, payload: EventPayload<K>): OutboxEventDescriptor;
  ```
  Payload schemas are **provisional** (names are frozen wire strings; shapes may firm up when stage 5 builds the consumers — payloads are not frozen). `buildOutboxEvent` uses `crypto.randomUUID()` and `EVENT_REGISTRY[name].parse(payload)`.
- `src/server/inngest/client.ts` — **new**: a singleton `Inngest` client typed from the registry — `new Inngest({ id: "personal-finance", eventKey: env.INNGEST_EVENT_KEY, schemas: new EventSchemas().fromZod(EVENT_REGISTRY) })`. Client `id` = the app name (`personal-finance`, matching the Portless host convention; memory: portless-host-is-personal-finance). `EVENT_REGISTRY` is already a record of Zod schemas, so `fromZod` consumes it directly and `inngest.send` becomes payload-typed.

### Tests (written first, TDD)

- `src/server/inngest/events.test.ts` — **written first**: `buildOutboxEvent("receipt/uploaded", { receiptId: "r1" })` returns `{ id: <uuid>, name, data }`, mints a distinct `id` each call, and **throws** on an invalid payload (registry parse). A compile-time check that `EventName` is the registry key union and `EventPayload<"receipt/uploaded">` is `{ receiptId: string }`, using `Expect`/`Equal` from `src/test/type-contracts.ts`.
- `src/server/inngest/registry-golden.test.ts` — **new** golden pinning the **frozen** `EVENT_REGISTRY` keys (function ids join in Phase 3). Names are byte-stable Inngest wire strings; changing one is deliberate + recorded, never a drive-by (per `.claude/rules/server-architecture.md` FROZEN note + adr002 clause 7).

### Success
**Automated**
- [x] `make check` passes (env typing resolves; registry types compile)
- [x] `make test` passes (`events.test.ts` + golden green)
- [x] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build` — bare `make build` fails on missing prod env locally; memory: make-build-needs-prod-env-locally)

**Manual**
- [x] `/security-review` (touches `src/env.js` — new secrets): `INNGEST_*` keys are server-only, `requiredInProd`, never `NEXT_PUBLIC_`, absent from client bundle. _(clean — no findings; keys server-only, no client-bundle path.)_

## Phase 2: `outbox` table + `commitWithOutbox` / `publish` on `db.transaction()` (+ revise adr003)

The write door. Canonical writes + outbox insert commit in one `db.transaction()`; a best-effort post-commit `inngest.send` is the fast path, the sweep (Phase 3) is the backstop (adr002 clause 3).

### Changes

- `docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md` — **revised in place** (Status stays `Accepted`; Date → `2026-09-01`; filename kept as the stable link key). Flip the decision from `neon-http`/`db.batch()` to **keep `postgres-js` + `db.transaction()`**, defer the swap, add the container-platform fork as option 4, keep `neon-serverless` `Pool` as Fork C, and record the three revisit triggers (connection-limit errors despite the pooled endpoint / measurable scale-to-zero cost / the stage-7 import pipeline forcing the uuid-PK migration). A Context sentence records the reversal of the 2026-08-10 decision; a retained deferred-uuid-PK section keeps adr002's inbound pointers landing. No adr013. _(Landed in the 2026-09-01 domain-model session ahead of implementation.)_
- `src/server/outbox/outbox.schema.ts` — **new** per-domain Drizzle table (adr005), discovered by the schema glob:
  ```ts
  export const outbox = pgTable("outbox", (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),        // app supplies its own uuid (idempotency key); default covers raw-SQL INSERTs
    eventName: d.text().notNull(),
    payload: d.jsonb().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    processedAt: d.timestamp({ withTimezone: true }),
    attempts: d.integer().notNull().default(0),
    lastError: d.text(),
  }), (t) => [
    index("outbox_unprocessed_idx").on(t.processedAt, t.createdAt).where(sql`${t.processedAt} is null`),
  ]);
  ```
- `src/server/db/index.ts` — `import * as outboxSchema from "~/server/outbox/outbox.schema"` and spread into the merged `schema` (`:13-22`), so `db.query.outbox` and drizzle-kit both see it.
- `src/server/outbox/commit.ts` — **new**: `makeCommitWithOutbox({ db, inngest })` → `commitWithOutbox(writes, events)`. `writes` is a callback `(tx) => Promise<T>` (the caller's canonical Drizzle writes); `events: OutboxEventDescriptor[]`. Body: `db.transaction(async tx => { const result = await writes(tx); if (events.length) await tx.insert(outbox).values(events.map(toRow)); return result })`, then **after commit** loop `events` → `inngest.send({ id: e.id, name: e.name, data: e.data })` in try/catch — on ok `db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.id, e.id))`; on failure `db.update(outbox).set({ attempts: sql\`attempts + 1\`, lastError: msg })` + `console.error` + **swallow** (the mutation's contract is "canonical rows committed", adr002 clause 3). Returns the caller's `result`.
- `src/server/outbox/index.ts` — **new** barrel: `makePublish({ db, inngest })` → `publish(event)` = an emit-only write (no other canonical rows) via `commitWithOutbox(async () => {}, [event])`; plus the **wired singletons** `commitWithOutbox` / `publish` composed with the real `db` (`~/server/db`) and `inngest` client (`~/server/inngest/client`), which stage-5 routers import.

### Tests (written first, TDD)

- `src/server/outbox/outbox.schema.test.ts` — **written first**: `getTableColumns` asserts `eventName.notNull`, `payload.notNull`, `createdAt.hasDefault`, `attempts.hasDefault`, `processedAt`/`lastError` nullable, `id` is the PK (mirrors `src/server/income/income.schema.test.ts`).
- `src/server/outbox/commit.test.ts` — **written first**, injected fakes (a fake `db` recording `transaction`/`insert`/`update` calls, a fake `inngest` recording `send`): (1) canonical writes + outbox insert both happen **inside** the transaction callback (ordering: writes before the outbox insert); (2) post-commit `inngest.send` carries **`id` = the outbox row id** (idempotency key) and is called **after** the transaction resolves; (3) a successful send stamps `processedAt`; (4) a throwing send **does not throw out of `commitWithOutbox`** (swallowed), bumps `attempts` + sets `lastError`, and the row stays unacked; (5) `publish(event)` writes exactly one outbox row and sends it, with no other canonical write; (6) `commitWithOutbox` returns the `writes` callback's result unchanged.

### Changes (migration)

- `drizzle/0005_outbox.sql` — `make db_generate`; review it is a single additive `CREATE TABLE "outbox"` + the partial index (no cast, no backfill); then `make db_migrate` (**user-run**, feature-branch DB; memory: db-migrate-and-env-are-user-run).

### Success
**Automated**
- [ ] `make check` passes (includes `db:check` — migration ↔ schema consistent)
- [ ] `make test` passes (schema-default + commit/publish fake-driven cases green)
- [ ] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [ ] Migration generated + applied on the **feature-branch** DB (never main/prod): `outbox` exists with all seven columns + `outbox_unprocessed_idx` — verified via SQL probe. _(generated as `0005_outbox.sql`; **apply is user-run** — `make db_migrate`.)_
- [ ] adr003 revised in place (Accepted, 2026-09-01) — decision is keep `postgres-js` + `db.transaction()`, swap deferred; no adr013.

## Phase 3: `outbox-sweep` + `outbox-prune` crons + Inngest route handler

Makes the rail run: the two scheduled functions plus the serve endpoint that Inngest calls. This is where the outbox actually delivers.

> **Library API (verified via Context7 `/inngest/website`, current):** `serve({ client, functions })` from `inngest/next` re-exports **`GET, POST, PUT`** (all three required); no `runtime` export needed (Node is the App-Router default) — set `export const maxDuration = 300` (recommended for the sweep on Vercel). `createFunction({ id }, { cron: "0 * * * *" }, async ({ step }) => …)` — the trigger is the **second arg** as a plain object; a cron handler receives `{ step }` but **no `event`**. Re-confirm the route-handler shape against `node_modules/next/dist/docs/01-app` at implementation time.

### Changes

- `src/server/outbox/outbox.workers.ts` — **new**, factories only (design `:89` — pure core + thin wrapper):
  - `makeRunSweep(deps)` → pure core: fetch unacked+aged rows (`processed_at is null and created_at < now() - interval '30 seconds'`, oldest first — the 30s floor cannot race a post-commit send, adr002 clause 4), and for each `deps.deliver({ id, name, data })` then mark processed; a delivery failure bumps `attempts`/`last_error` and **leaves the row unacked** for the next sweep. Returns a delivered/failed count. Idempotency is the row `id` as the Inngest event `id` (adr002 clause 5) — a sweep racing the post-commit send is a guaranteed no-op. Inngest's dedup window is **24h**, comfortably longer than the hourly sweep, so any re-send is deduped; an unacked row older than 24h is a genuinely stuck one whose earlier sends never succeeded, so a fresh delivery on recovery is correct (no double-fire).
  - `makeSweepWorker({ db, inngest })` → `inngest.createFunction({ id: "outbox-sweep" }, { cron: "0 * * * *" }, ({ step }) => runSweep())`.
  - `makeRunPrune(deps)` → pure core: delete rows where `processed_at < now() - interval '7 days'`; **never** deletes unacked (`processed_at is null`) or stuck rows — they stay visible until cleared deliberately (adr002 `:100`). Returns a deleted count.
  - `makePruneWorker({ db })` → `inngest.createFunction({ id: "outbox-prune" }, { cron: "0 3 * * *" }, () => runPrune())`.
  - The composition root builds the two workers **once** at module scope with the real `db` + `inngest` client.
- `src/server/inngest/functions.ts` — **new**: `export const functions = [sweepWorker, pruneWorker]` (the served registry).
- `src/app/api/inngest/route.ts` — **new** route handler: `export const { GET, POST, PUT } = serve({ client: inngest, functions })` plus `export const maxDuration = 300`. Node runtime is the App-Router default (no `runtime` export). `serve` verifies every incoming request against `INNGEST_SIGNING_KEY` in prod; the local Dev Server needs no keys (auto-detected dev / `INNGEST_DEV`).
- `src/server/inngest/registry-golden.test.ts` — extend to also pin the **frozen** function ids `outbox-sweep`, `outbox-prune`.

### Tests (written first, TDD)

- `src/server/outbox/outbox.workers.test.ts` — **written first**, injected fakes: **sweep** — only unacked **and** aged rows are delivered (a <30s-old unacked row is skipped); the Inngest event `id` equals the outbox row `id`; a delivered row is marked processed; a failing delivery bumps `attempts`/`last_error` and the row stays unacked (re-delivered next run). **prune** — deletes only rows whose `processed_at` is older than 7 days; leaves recently-processed rows, unacked rows, and stuck rows (`processed_at is null and attempts > N`) untouched.

### Success
**Automated**
- [ ] `make check` passes
- [ ] `make test` passes (sweep/prune fake-driven cases + extended golden green)
- [ ] Build compiles clean (`SKIP_ENV_VALIDATION=1 yarn build`)

**Manual**
- [ ] `/security-review` (new public webhook route `src/app/api/inngest/route.ts`): confirm `serve` verifies the `INNGEST_SIGNING_KEY` signature and rejects unsigned/forged requests; no secret leaks in the served introspection response.
- [ ] End-to-end rail smoke via the **Inngest Dev Server** (**user-run**, needs the feature-branch DB; the Dev Server needs no Inngest keys): run the app + `npx --ignore-scripts=false inngest-cli@latest dev -u https://personal-finance.localhost/api/inngest` (polls the serve endpoint, auto-discovers `outbox-sweep`/`outbox-prune`; dashboard at `http://localhost:8288`); `INSERT` a `pending` outbox row (SQL / Studio, per `.claude/rules/database-migrations.md`); invoke `outbox-sweep` → the event appears in the stream and the row's `processed_at` is stamped. Invoke `outbox-prune` → a recently-processed row and a stuck (`processed_at is null`) row both survive. _(Worker **execution** of a receipt event is stage 5 — stage 4 proves delivery + acknowledgement only.)_

## Validate

Run `/validate` over the whole branch (its standing `/code-review` step — do not add per-phase). Confirm: the outbox write path is one `db.transaction()` (canonical + outbox row) with a **best-effort, swallowed** post-commit send (adr002 clause 3); no `db.batch()`/`neon-http` introduced and no `category.ts` rewrite; the outbox row `id` is the Inngest idempotency key everywhere it is sent; sweep carries the 30s floor and prune never touches unacked/stuck rows; `EVENT_REGISTRY` keys + function ids (`outbox-sweep`/`outbox-prune`) are golden-pinned; migration `0005` is additive-only and applied only on a feature-branch DB; plain-helper style held (no repository/service/module tier); `inngest` is the only new dependency; adr003 is revised in place (Accepted, keep `postgres-js` + `db.transaction()`, swap deferred) and there is no adr013.

## References

- Design doc: `thoughts/designs/2026-08-16-expense-linking-receipts-cashflow.md` — Build order item 4 (`:144`), "Infrastructure: outbox + Inngest" (`:79-89`), the adr004 deviation (`:89`); carries `## Related ADRs` (`:149-154`)
- Prior plan: `thoughts/plans/2026-09-01-expense-linking-stage-3.md` — conventions this mirrors; the `.claude/rules/server-architecture.md`-is-fiction flag (`:36`)
- ADRs:
  - `docs/adr/adr002-canonical-postgres-store-transactional-outbox.md` (Accepted) — **implemented here**: outbox table shape (`:82-96`), at-least-once + swallowed post-commit send (clause 3, `:46`), sweep/prune cadence (`:47,100`), row-id idempotency (clause 5, `:48`), typed `EVENT_REGISTRY` (clause 7, `:50`)
  - `docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md` (Accepted, **revised in place 2026-09-01, in Phase 2**) — decision of record: keep `postgres-js` + `db.transaction()` (satisfies adr002 clause 2), defer the `neon-http`/`db.batch()` swap and the container-pooling move until a connection/scale trigger fires. No adr013
  - `docs/adr/adr005-per-domain-drizzle-schema-files.md` — `outbox` table home `src/server/outbox/outbox.schema.ts`; two-step migration
  - `docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md` — governs style: plain helpers, no 3-tier repository/service/module ceremony
- Key code: `src/server/db/index.ts:1-35` (driver + schema merge), `src/server/api/routers/category.ts:94,125` (the two interactive-tx sites that stay), `src/server/income/income.schema.ts:4-7` (enum bridge + schema template), `src/server/income/income.schema.test.ts` (schema-test template), `src/env.js:5-6,47-48,67-76` (`requiredInProd` env pattern), `src/server/api/trpc.ts:29-38` (context), `src/server/api/root.ts:15-23` (router registry — unchanged, no producer), `src/test/type-contracts.ts` (`Expect`/`Equal`/`WritesInto`), `.claude/rules/database-migrations.md` (two-step migrations + the outbox-INSERT trigger idiom)
- Library docs: `inngest` (verify via Context7 `/inngest/inngest-js` + `node_modules/next/dist/docs/01-app`) — `serve` route-handler export, `Inngest` + `EventSchemas`, `send` idempotency `id`, `createFunction` cron + `step.run`
