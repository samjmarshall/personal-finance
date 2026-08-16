# Better Auth secondary storage on Upstash Redis — Implementation Plan

## Context

Better Auth turns rate limiting on in production but falls back to `storage: "memory"` when no secondary storage is set, so the counter lives in one Vercel lambda and dies on cold start — the rate limit does not actually work. Separately, every tRPC request and every dashboard render resolves a session against Postgres, which will burn the Neon connection budget ADR003 exists to protect. Wiring an Upstash Redis secondary storage adapter fixes the rate-limit defect now and moves session and verification reads off Postgres, with Postgres retained as the durable copy so a Redis miss never signs anyone out.

## Current State

- `src/server/better-auth/config.ts:14-46` — no `secondaryStorage`, no `cookieCache`, no `verification` block, no `rateLimit`. Reads `process.env.*` directly; does **not** import `~/env`.
- `src/server/better-auth/config.ts:33-36` — `session` is `expiresIn: 7d`, `updateAge: 1d` only.
- `src/env.js:10-13` — the conditional-required pattern to copy (`BETTER_AUTH_SECRET`); `runtimeEnv` at `src/env.js:38-43`. No KV vars.
- Session read paths are exactly two: `src/server/better-auth/server.ts:5-6` (React `cache()` wrapper, consumed by `src/app/(dashboard)/layout.tsx:11`, `src/app/sign-in/page.tsx:8`, `src/app/sign-up/page.tsx:8`) and `src/server/api/trpc.ts:30`. No `middleware.ts`, so no edge-runtime read.
- **No test runner exists.** `Makefile:40-41` and `Makefile:43-44` are `@echo "skip: …"` stubs. No vitest/jest/playwright in `package.json` or `yarn.lock`.
- `Makefile:5` exports `NODE_OPTIONS=--conditions=react-server`; `Makefile:10` already clears it for `test` and `test_e2e`. That seam is in place.
- `package.json:22-41` — production deps are exact-pinned, devDeps use caret (`package.json:42-53`), per `.claude/rules/package.json.md:6`.
- `docs/adr/adr006-…:2` and `docs/adr/adr007-…:2` are both `Status: 'Proposed'`.
- `docs/adr/adr003-…:55-60` — neon-http has **not** landed; `src/server/db/index.ts` is still `postgres-js`. The connection-budget driver is anticipatory, not a live defect.
- No CI runs lint/typecheck/tests. `.husky/pre-commit:1` runs `make check`; `.github/workflows/post-deploy.yml` only does `db:check` + `db:migrate`.

## Desired End State

`auth` is configured with an Upstash-backed `secondaryStorage`. Sessions and verification records are dual-written to Redis and Postgres, read Redis-first, and fall through to Postgres on a miss or a Redis outage. Rate-limit counters are shared across lambdas. Redis keys are namespaced by `VERCEL_ENV` plus a `DATABASE_URL` fingerprint, so a cached session can only be read alongside the database that created it. Reads, writes and increments fail open; deletes fail closed. A Vitest suite covers the adapter's failure posture and prefixing.

## Out of Scope

- The `neon-http` migration (ADR003) — independent.
- Telemetry / alerting for silent Redis degradation (design doc:332).
- Sweeping expired `session` rows (design doc:334) — ~52 rows/year at current usage.
- A separate Upstash database per environment (design doc:336) — the fingerprint already handles correctness; this is blast radius only.
- `getAndDelete` — deliberately not implemented (ADR007:41).
- Component/e2e testing. `Makefile:43-44` stays a stub; no jsdom, no testing-library.

## Approach

Four phases, two PRs' worth of review surface. Phase 1 lands the test runner alone — a runner and a session-storage rewrite reviewed together means neither is reviewed properly (design doc:299). Phase 2 builds the adapter test-first as a pure function of its arguments, so it needs no env and no Redis. Phase 3 wires it into the composition root, which is the only place that touches env. Phase 4 proves the rate-limit fix on a preview deployment — it is structurally unprovable locally — and flips both ADRs to `Accepted`.

## Phase 1: Vitest test runner

Lands in its own PR. Implements decision 9 (design doc:46, 297-299).

### Changes

- `package.json` — add devDep `vitest` (caret is allowed for devDeps per `.claude/rules/package.json.md:6`). Add scripts `"test": "vitest run"` and `"test:watch": "vitest"`.
  - **Deviation from plan:** `vite-tsconfig-paths` was *not* added. vitest 4.1.10 pulls vite 8.2.1, which resolves tsconfig paths natively and prints a notice telling you to drop the plugin. `resolve: { tsconfigPaths: true }` replaces it — one fewer devDep, no warning.
- `vitest.config.ts` (new) — `resolve: { tsconfigPaths: true }` so `~/` resolves from `tsconfig.json:29-32`. Set `test.include: ["src/**/*.test.ts"]` — **scoping to `src/**` is load-bearing**: `.claude/skills/write-tickets/scripts/rules.test.ts` runs on `node:test` and must not be collected. `environment: "node"`. No jsdom, no `@vitejs/plugin-react`.
- `Makefile:38-41` — replace the `test` stub body with `yarn run test` and drop the now-stale "no unit runner is wired up yet" comment. Leave `test_e2e` alone. `Makefile:10` already clears `NODE_OPTIONS` for this target.
- `src/lib/utils.test.ts` (new) — cover `formatMonthKey` (`src/lib/utils.ts:46-50`), both the parsed branch and the `if (!year || !month) return key` guard. Real coverage, and it proves the `~/` alias resolves — `vitest run` fails outright with zero test files.

Note: `tsconfig.json:34-42` includes `**/*.ts`, so `vitest.config.ts` and every test file are typechecked by `make check` automatically. No tsconfig change needed.

### Success

**Automated**
- [x] `make check` passes
- [x] `make test` passes

**Manual**
- [x] `make test` prints vitest output, not `skip: no unit test runner configured`
- [x] `.claude/skills/write-tickets/scripts/rules.test.ts` is not in vitest's collected file list

## Phase 2: Redis secondary-storage adapter

Implements `docs/adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md` (Proposed).

### Changes

- `package.json` — add `@upstash/redis` to `dependencies`, **exact pin, no `^`** (`.claude/rules/package.json.md:6`). Commit the `yarn.lock` update in the same commit.
- `src/server/better-auth/secondary-storage.ts` (new) — `createSecondaryStorage({ url, token, prefix })` returning `{ get, set, delete, increment }`. Implementation is specified verbatim at design doc:141-196. Placement beside `config.ts` follows ADR004:48 (`better-auth/` is collapsed infrastructure with no domain). The prefix is an **argument, not a `process.env` read** — that is what keeps the adapter testable without env mutation.
  - `get` — unwrap the Upstash REST client's auto-parsed JSON back to a string; on throw, log and return `null`.
  - `set` — `{ ex: ttl }` when `ttl` is truthy; TTL is in **seconds**; on throw, log and continue.
  - `increment` — `INCR`, then `EXPIRE` only when the count is `1`; on throw, log and return `0` (allowed).
  - `delete` — **no `try`/`catch`.** ADR007:52 records that adding one for consistency is an authentication bypass.
- `src/server/better-auth/secondary-storage.test.ts` (new) — TDD vertical slice (one test → one impl → repeat, per the `tdd` skill) against a mocked `@upstash/redis` client, covering design doc:302-309:
  - `get` re-stringifies an object the REST client already parsed
  - `get` returns `null` when the client throws
  - `set` swallows a throw
  - `set` passes `{ ex: ttl }` when a TTL is given and omits it otherwise
  - `increment` returns `0` when the client throws
  - `increment` sets the TTL only on the first call
  - `delete` propagates a throw
  - every method applies the injected prefix

No `import "server-only"` in either file. Nothing under `src/server/**` carries one today, ADR004:55 is recorded as not-started (`adr004-…:59-63`), and `Makefile:10` strips the `react-server` condition for test targets — the marker would throw at import under vitest.

### Success

**Automated**
- [x] `make check` passes
- [x] `make test` passes — 13 adapter cases green (the eight planned, plus five from the security findings below)

**Manual**
- [x] `/security-review` — found two real defects; both fixed, ADR007 amended
- [x] `git diff` on `secondary-storage.ts` shows no `try`/`catch` wrapping `delete`

**Deviation from plan — two security findings, both verified against `node_modules`:**

1. **Bulk revocation could be silently defeated.** ADR007 recorded `active-sessions-<userId>` drift as "cosmetic only". That holds only for single sign-out. `deleteSecondaryStorageSessions` (`internal-adapter.mjs:60-67`) derives the tokens to delete *solely* from that key, then `deleteUserSessions` drops every Postgres row regardless — so one swallowed `get` revokes nothing while reporting success, leaving orphan keys that authenticate for the full 7-day TTL. Fix: `get` and `set` now fail **closed** for `active-sessions-*` keys (session-token reads still fail open). Cost, approved by Sam: sign-in fails while Redis is down.
2. **Session tokens and user PII were being logged.** `UpstashError` embeds the whole command in its message (`chunk-K7RP6Y36.mjs:203`); `UpstashJSONParseError` quotes 200 chars of the response body and is thrown on the *success* path too (`nodejs.js:53,271`), where that body is the session itself. Fix: `logFailure` keeps Upstash's reason, drops the command, and logs only the error name for parse failures.

`deleteSessions` has the same fail-open-`get`-guards-`delete` shape but is unreachable — only the `multi-session` plugin calls it, which `config.ts` does not enable. Recorded in ADR007 as a trap for whoever enables it.

ADR007 amended now (not deferred to Phase 4): title, decision table, the falsified "cosmetic only" bullet, and the new consequences.

## Phase 3: Wire secondary storage into Better Auth

Implements `docs/adr/adr006-redis-session-cache-with-postgres-durable-copy.md` (Proposed).

### Changes

- `src/env.js` — add `KV_REST_API_URL: process.env.NODE_ENV === "production" ? z.url() : z.url().optional()` and `KV_REST_API_TOKEN` with `z.string()`, mirroring `BETTER_AUTH_SECRET` at `src/env.js:10-13`. Add both to `runtimeEnv` (`src/env.js:38-43`). Keep entries alphabetical.
- `src/server/better-auth/config.ts` — the composition root; full snippet at design doc:204-242.
  - Add `import { env } from "~/env"` (first use in this file; matches `src/server/db/index.ts:4`) and `import { createHash } from "node:crypto"`.
  - `dbFingerprint` = first 8 hex chars of SHA-256 of `env.DATABASE_URL`; prefix = `` `ba:${process.env.VERCEL_ENV ?? "development"}:${dbFingerprint}:` ``. `VERCEL_ENV` stays an unvalidated `process.env` read, matching `config.ts:6-12` — Vercel system vars are not ours to validate, KV credentials are.
  - Build `secondaryStorage` only when both KV vars are present; `console.warn("[auth:redis] KV not configured …")` when it is undefined outside production.
  - Extend `session` (`config.ts:33-36`) with `storeSessionInDatabase: true` and `cookieCache: { enabled: true, maxAge: 60 }`. **Do not set `preserveSessionInDatabase`** — its `false` default is what enables the Postgres fallback; setting it `true` disables it (ADR006:65).
  - Add `verification: { storeInDatabase: true }`, `secondaryStorage`, and `rateLimit: { storage: "secondary-storage" }`. Rate-limit rules and `enabled` keep Better Auth's defaults.
- `.env.example` — add `KV_REST_API_URL` and `KV_REST_API_TOKEN`. (`.claude/scripts/block-env-file-read.sh` blocks agent reads of `.env*`; edit this by hand.)

**Expected gotcha:** `next build` sets `NODE_ENV=production`, so `make build` and `yarn preview` fail locally without the KV vars in `.env` (design doc:269). Pull them with `vercel env pull` first. CI is unaffected — `post-deploy.yml:95-106` only runs `db:check`/`db:migrate` with `SKIP_ENV_VALIDATION: 1`.

### Success

**Automated**
- [x] `make check` passes
- [x] `make test` passes
- [x] `make build` passes (needs KV vars in `.env`)

**Manual** — design doc:314-323
- [x] Sign in, reload — session persists (catches JSON auto-parse)
- [x] Key TTL reads ~604800, not 604800000 (seconds vs ms) — observed `ttl=604789`
- [x] Key reads `ba:development:<fingerprint>:<token>` — `ba:development:9bd58c15:v9reF6…`
- [x] Row in `session` **and** key in Redis (dual-write) — same token in both, twice
- [x] `DEL` the Redis key — still signed in. **This is the one that matters**; it is the only proof the safety net works rather than merely existing in config
- [x] Point the adapter at a bad URL — still signed in (fail-open reads). Log read `[auth:redis] get failed fetch failed` — reason only, no token, no PII
- [x] Sign out — key and row both gone
- [x] No Redis call on a second request within 60s (cookie cache)
- [x] Two worktrees on different Neon branches do not share a session (DB fingerprint)
- [x] `/security-review` — one real MEDIUM found and fixed (see below)

**Deviation from plan — `rateLimit.storage` must track `secondaryStorage`.**

The plan specified `rateLimit: { storage: "secondary-storage" }` unconditionally. That is
unsafe when `secondaryStorage` is `undefined`: it overrides Better Auth's own
`options.secondaryStorage ? "secondary-storage" : "memory"` selection
(`context/create-context.mjs:174`), and the secondary-storage backend then reads through
`ctx.options.secondaryStorage?.get` — always `undefined` → `null` → `decideConsume(null, …)`
returns `allowed: true` unconditionally (`api/rate-limiter/index.mjs:25-35`). Rate limiting is
not degraded to per-lambda memory, it is off. Reachable in any production runtime started
with `SKIP_ENV_VALIDATION` and no KV vars, where `rateLimit.enabled` still defaults to true.
Now `storage: secondaryStorage ? "secondary-storage" : "memory"`.

**Verification notes**
- The cookie cache refreshes on read, so reloading a page never expires it. The `DEL`-then-still-signed-in
  check only proves the Postgres fallback when the cookie cache is bypassed — done via
  `GET /api/auth/get-session?disableCookieCache=true`, which returned the session while the Redis
  token key was absent.
- Better Auth does not re-populate Redis on a Postgres-fallback read; the key returns at the next
  session refresh (`updateAge`, 1 day). Consistent with ADR006 — Postgres is the durable copy.
- The DB-fingerprint check was verified by computing the prefix for a second Neon branch URL
  (`9bd58c15` vs `38f2b4e0`) rather than by provisioning a second worktree.
- The `active-sessions-<userId>` manifest key survives sign-out (Better Auth empties it rather than
  deleting it). Expected, not drift.

## Phase 4: Preview verification and ADR acceptance

The rate-limit defect cannot be reproduced or fixed-verified locally: `rateLimit.enabled` defaults to `isProduction`, and one local Node process has one memory, so the check passes with the bug still present (design doc:328).

### Changes

- `docs/adr/adr006-redis-session-cache-with-postgres-durable-copy.md:2` — `Status: 'In Progress'` → `'Accepted'`
- `docs/adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md:2` — `Status: 'In Progress'` → `'Accepted'`

Per `.claude/skills/domain-model/ADR-FORMAT.md:45`. Flipped after the production check below passed.

### Success

**Automated**
- [x] `make check` passes

**Manual** — verified against **production**, not preview (see deviation below)
- [x] Four rapid sign-in attempts return 429 — observed `401,401,401,429` on `finance.sammarshall.co`
- [x] Redis keys carry the env + fingerprint prefix, distinct from local — observed `ba:production:2324d0be:*` (local is `ba:development:*`)
- [x] No `[auth:redis]` errors during the check — the counter key was written, which a failing `increment` (fail-open to `0`) would not do

**Deviation from plan — verified against production, not a preview deployment.**

The preview deployment's `KV_REST_API_URL`/`KV_REST_API_TOKEN` are misconfigured: probes never
produced a 429 and never wrote a `ba:preview:*` key to the shared Upstash (scanned within the 10s
TTL). Not a code defect — the same adapter + creds increment `1..5` locally. Missing vars would
fall back to `"memory"`, which *would* rate-limit; the observed silence means `secondaryStorage` is
wired to creds that don't reach Redis, so `increment` throws and fails open. Since production has
working KV creds, PR #8 was merged and the fix verified there instead. **Follow-up: fix the
Preview-scoped KV vars** — until then preview has no rate limiting and Postgres-only sessions.

## References

- Design doc: `thoughts/designs/2026-08-11-better-auth-upstash-secondary-storage.md` (carries `## Related ADRs`)
- ADRs:
  - `docs/adr/adr006-redis-session-cache-with-postgres-durable-copy.md` (Proposed) — implemented by Phase 3, accepted in Phase 4
  - `docs/adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md` (Proposed) — implemented by Phase 2, accepted in Phase 4
  - `docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md:55-60` (Accepted, not started) — the connection-budget driver this work anticipates
  - `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md:48` (Accepted) — `better-auth/` as collapsed infrastructure, fixes adapter placement
- Rules: `.claude/rules/package.json.md:6` (exact pins for prod deps), `.claude/rules/server-architecture.md`, `.claude/rules/jsdoc-concise.md`
- Related: `src/server/better-auth/config.ts:14-46`, `src/env.js:10-13`, `src/server/api/trpc.ts:29-38`, `Makefile:10`, `Makefile:38-44`
