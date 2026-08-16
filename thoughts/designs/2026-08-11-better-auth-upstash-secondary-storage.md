# Better Auth secondary storage on Upstash Redis

**Date:** 2026-08-11
**Author:** Sam Marshall
**Status:** Design agreed and grilled, not implemented

## Context

Two problems drive this work.

**Rate limiting does not work in production.** Better Auth enables rate limiting in production by default but defaults `storage` to `"memory"` when no secondary storage is configured (`context/create-context.mjs:171-174`). On Vercel that counter lives in one lambda and dies on cold start, so an attacker moves to a fresh instance. This is the concrete defect.

**Session reads will consume the Neon connection budget** that ADR003 exists to protect. `createTRPCContext` (`src/server/api/trpc.ts:29-31`) resolves a session on every tRPC request, and `getSession` (`src/server/better-auth/server.ts:5`) is called from `(dashboard)/layout.tsx`, `sign-in/page.tsx` and `sign-up/page.tsx`. React `cache()` dedupes within a render, so the real cost today is one read per render plus one per tRPC request — `app-nav.tsx` does not call it.

Note this driver is anticipatory. `src/server/db/index.ts:1-2` still runs `drizzle-orm/postgres-js` over a pooled connection. ADR003 chose `neon-http`, but that migration has not landed, so these are not yet per-call HTTP round trips.

An Upstash Redis instance already exists, provisioned through Vercel. It exposes `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

## What secondary storage does

Setting `secondaryStorage` moves four things out of Postgres.

| Data | Moves by default | Key |
|---|---|---|
| Sessions | Yes | `<token>` |
| Per-user session list | Yes | `active-sessions-<userId>` |
| Verification records | Yes — **and with no Postgres copy** | `verification:<identifier>` |
| Rate limit counters | Yes | ip + path |

Verified against `internal-adapter.mjs:207-241` and `context/create-context.mjs:174`.

Rate limits need no separate opt-in in 1.6.26 — `storage` resolves to `"secondary-storage"` automatically once `secondaryStorage` is set. Configuring it explicitly is a version pin, not the mechanism.

## Decisions

| # | Decision | Value |
|---|---|---|
| 1 | Scope | Sessions, verification records, and rate limits |
| 2 | Session durability | Dual-write: `storeSessionInDatabase: true`, `preserveSessionInDatabase: false` |
| 3 | Verification durability | Dual-write: `verification.storeInDatabase: true` |
| 4 | Environment isolation | Key prefix from `VERCEL_ENV` **and a `DATABASE_URL` fingerprint** |
| 5 | Failure posture | `get` / `set` / `increment` fail open; `delete` fails closed |
| 6 | Cookie cache | Enabled, `maxAge: 60` |
| 7 | Rate limits | Built-in defaults, storage pinned to `secondary-storage` |
| 8 | Env vars | Required in production, optional elsewhere; pulled locally |
| 9 | Testing | Vitest, landed in a separate PR first |

## Architecture

### Dual-write, and why it is not redundant

`internal-adapter.mjs:243-246` decides whether a Redis miss falls back to Postgres:

```js
if (secondaryStorage) {
  const sessionStringified = await secondaryStorage.get(token);
  if (!sessionStringified && (!options.session?.storeSessionInDatabase || ctx.options.session?.preserveSessionInDatabase)) return null;
```

Only `storeSessionInDatabase: true` **with** `preserveSessionInDatabase: false` falls through to the Postgres read at L265. Every other combination returns `null` and logs the user out.

`preserveSessionInDatabase: true` looks like the safer option and is the opposite. It keeps revoked rows, so Better Auth disables the fallback to stop revoked sessions resurrecting.

Writes are rare — one per login, plus one refresh per day from the existing `updateAge: 60 * 60 * 24`. Reads all come from Redis. The safety net costs close to nothing.

### Verification records need the same treatment, explicitly

Sessions get a safety net by default. Verification records do not:

```js
// internal-adapter.mjs:593-600 — write
executeMainFn: options.verification?.storeInDatabase   // undefined → Postgres write skipped

// internal-adapter.mjs:618 — read
if (!options.verification?.storeInDatabase) return null;   // no Postgres fallback
```

Left alone, single-use credentials become Redis-only. A blip turns every password-reset link into "invalid or expired", and an eviction does it permanently.

Impact today is zero — `config.ts` has no `sendResetPassword`, no `emailVerification`, no email provider, and the `verification` table (`shared.schema.ts:53`) is empty. Setting `verification: { storeInDatabase: true }` now stops whoever adds password reset later from inheriting the gap invisibly. Reads still check Redis first (`internal-adapter.mjs:605-617`), so nothing gets slower.

This also removes the need for `getAndDelete`. Its only call site (`internal-adapter.mjs:695`) sits inside `if (secondaryStorage && !options.verification?.storeInDatabase)`, which is now unreachable; consumption goes down Better Auth's Postgres transaction path, which is atomic on its own.

### Failure posture

Better Auth does not wrap `secondaryStorage` calls in `try`/`catch`. The only `try` blocks in `internal-adapter.mjs` guard `JSON.parse` (L122, L286), and `onRequestRateLimit` awaits `storage.consume` bare (`rate-limiter/index.mjs:343`). An Upstash outage therefore throws, the request returns 500, and the Postgres fallback never runs.

The adapter must convert a throw into a benign result. Each operation gets the posture its fallback supports:

| Operation | On failure | Why |
|---|---|---|
| `get` | Log, return `null` | Presents as a miss, so the Postgres fallback takes over |
| `set` | Log, continue | Postgres already holds the row |
| `increment` | Log, return `0` (allowed) | A throw 500s every browser request to `/api/auth/*` |
| `delete` | **Throw** | No fallback exists, and swallowing it is an auth bypass |

**Why `increment` fails open.** The rate limit hook runs in the router's `onRequest` (`api/index.mjs:168`) and covers every `/api/auth/*` request, including the default global rule of 100 per 10s on all paths. Fail-closed means nobody can sign in during an Upstash blip. Fail-open means rate limiting stops working — which is exactly today's behaviour, so it loses a defence that is not yet in place. Server-side `auth.api.getSession` calls bypass the router and are unaffected either way.

**Why `delete` fails closed.** The delete order matters:

```js
// internal-adapter.mjs:393-395
await secondaryStorage.delete(token);
if (databaseStoresSessions && !preservesDatabaseSessions) await deleteWithHooks(...);
```

Swallowing the first line lets the second run. The Postgres row disappears, the Redis key survives, and `findSession` checks Redis first — a revoked session keeps authenticating for up to seven days with no row left to contradict it. Throwing aborts before the Postgres delete, so both copies survive intact and the user sees an error they can retry.

### Environment isolation

Better Auth stores the raw token as the key, with no namespace. `scripts/neon-branch.sh:130-139` gives every git branch its own `DATABASE_URL`, so "which environment am I" and "which database am I caching" are different axes:

| Situation | `VERCEL_ENV` alone | Database | Correct? |
|---|---|---|---|
| Two local worktrees | same | Different Neon branches | **No** |
| Two preview deployments | same | Different Neon branches | **No** |
| Local on `main` | `development` | Production DB | Different namespace, same data |

Worktrees are the one that bites during ordinary work: they all run on localhost, and **cookies ignore port**, so a session created against branch A's database authenticates against branch B's — `findSession` returns the cached blob and never asks branch B's Postgres whether that user exists.

The prefix is therefore keyed to the database, not the environment:

```
ba:${VERCEL_ENV ?? "development"}:${dbFingerprint}:
```

`dbFingerprint` is a truncated SHA-256 of `DATABASE_URL`. This makes one property structural: **a cached session can only be read alongside the database that created it.** The `VERCEL_ENV` segment is kept purely so keys stay readable — `ba:preview:a3f9c1d2:<token>`.

Rotating the Neon connection string orphans the namespace. That degrades exactly as designed: every read misses, falls through to Postgres, nobody is logged out, and the orphans expire on their own TTL.

This still shares one Upstash instance, so development burns production quota and a stray `FLUSHALL` hits everything. A database per environment remains the end state, but for blast radius rather than correctness.

## Components

### `src/server/better-auth/secondary-storage.ts` (new)

ADR004:48 lists `better-auth/` as collapsed infrastructure with no domain, so the adapter lives beside `config.ts`. No `server-only` marker — nothing under `src/server/**` carries one.

The prefix is injected rather than read from `process.env` at module scope, which keeps the adapter a pure function of its arguments and makes the prefix testable without env mutation.

```ts
import { Redis } from "@upstash/redis";

type Options = {
  url: string;
  token: string;
  /** Namespaces every key — Better Auth keys are raw tokens with no namespace of their own. */
  prefix: string;
};

export function createSecondaryStorage({ url, token, prefix }: Options) {
  const redis = new Redis({ url, token });

  return {
    get: async (key: string) => {
      try {
        const value = await redis.get(prefix + key);
        if (value === null || value === undefined) return null;
        // The Upstash REST client parses JSON for us; Better Auth expects a string.
        if (typeof value === "string") return value;
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      } catch (error) {
        console.error("[auth:redis] get failed", error);
        return null; // Presents as a miss, so the Postgres fallback runs.
      }
    },

    set: async (key: string, value: string, ttl?: number) => {
      try {
        if (ttl) await redis.set(prefix + key, value, { ex: ttl });
        else await redis.set(prefix + key, value);
      } catch (error) {
        console.error("[auth:redis] set failed", error);
      }
    },

    // No catch. Swallowing this lets Better Auth delete the Postgres row, leaving an
    // orphan key that authenticates for up to 7 days. See adr007.
    delete: async (key: string) => {
      await redis.del(prefix + key);
    },

    increment: async (key: string, ttl: number) => {
      try {
        const count = await redis.incr(prefix + key);
        if (count === 1) await redis.expire(prefix + key, ttl);
        return count;
      } catch (error) {
        console.error("[auth:redis] increment failed", error);
        return 0; // Allowed. A throw 500s every /api/auth/* request.
      }
    },
  };
}
```

TTL is in **seconds**. Better Auth computes it as `Math.floor((expiresAt - now) / 1000)` and calls `set` only when it exceeds zero.

### `src/server/better-auth/config.ts` (edit)

The composition root owns env access and builds the prefix:

```ts
import { createHash } from "node:crypto";
import { env } from "~/env";
import { createSecondaryStorage } from "./secondary-storage";

const dbFingerprint = createHash("sha256")
  .update(env.DATABASE_URL)
  .digest("hex")
  .slice(0, 8);

const prefix = `ba:${process.env.VERCEL_ENV ?? "development"}:${dbFingerprint}:`;

const secondaryStorage =
  env.KV_REST_API_URL && env.KV_REST_API_TOKEN
    ? createSecondaryStorage({
        url: env.KV_REST_API_URL,
        token: env.KV_REST_API_TOKEN,
        prefix,
      })
    : undefined;
```

`VERCEL_ENV` stays a raw `process.env` read, matching `config.ts:6-12`, which reads `V0_RUNTIME_URL`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` the same way. Vercel system vars are not ours to validate; KV credentials are.

`node:crypto` is safe — no file in `src` exports `runtime`, so everything is on the Node runtime and `createHash` runs once at module load.

Then:

```ts
session: {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
  storeSessionInDatabase: true,
  cookieCache: { enabled: true, maxAge: 60 },
},
verification: { storeInDatabase: true },
secondaryStorage,
rateLimit: { storage: "secondary-storage" },
```

`preserveSessionInDatabase` stays at its `false` default. Leave it alone — setting it disables the fallback.

Rate limits keep Better Auth's built-in rules (`rate-limiter/index.mjs:370-383`): three requests per ten seconds on `/sign-in*`, `/sign-up*`, `/change-password*` and `/change-email*`; three per sixty seconds on password-reset and verification sends. Plus the global default of 100 per 10s on every path. Those cover the whole surface, since this app has no OAuth and no plugins. Keys combine IP and path, so this stops casual brute force, not distributed attacks.

`rateLimit.enabled` keeps its default — off in development, on in production.

### `src/env.js` (edit)

Follow the existing `BETTER_AUTH_SECRET` pattern at line 9:

```js
KV_REST_API_URL: process.env.NODE_ENV === "production" ? z.url() : z.url().optional(),
KV_REST_API_TOKEN: process.env.NODE_ENV === "production" ? z.string() : z.string().optional(),
```

Add both to `runtimeEnv`. When either is missing outside production, `config.ts` leaves `secondaryStorage` undefined and logs a warning so the active path stays obvious:

```ts
if (!secondaryStorage && process.env.NODE_ENV !== "production") {
  console.warn("[auth:redis] KV not configured — sessions falling back to Postgres");
}
```

A missing variable in production fails at boot rather than silently disabling rate-limit storage.

**Expect this gotcha:** `next build` sets `NODE_ENV=production`, so `yarn build` and `yarn preview` will fail locally without KV vars in `.env`. CI is unaffected — `post-deploy.yml` only runs install, `db:check` and `db:migrate`.

### `package.json` (edit)

Add `@upstash/redis` pinned exactly, no `^` — `.claude/rules/package.json.md` requires it for production dependencies.

### Cookie cache

The signed cookie holds the `{ session, user }` blob. While valid, `getSession` touches neither Redis nor Postgres, which removes most of the per-request cost described in Context.

Sixty seconds caps the revocation lag. Signing out on the current device clears the cookie immediately; the lag applies only to sessions revoked from elsewhere and to stale profile data. `getSession` accepts `disableCookieCache: true` per call — the escape hatch for sensitive operations later. `freshAge` keeps its one-day default and needs no change.

## Data flow

**Read.** Cookie cache hit returns immediately. On miss, Better Auth reads Redis. On a Redis miss or error, it reads Postgres.

**Write.** `createSession` writes the token key and `active-sessions-<userId>` to Redis, then writes the row to Postgres.

**Revoke.** `deleteSession` reads the token key, rewrites or deletes the session list, deletes the Redis token key, then deletes the Postgres row. A Redis delete failure surfaces to the caller and aborts before the Postgres delete, so nothing is revoked in either store.

A fail-open `get` inside `deleteSession` skips the session-list cleanup, leaving a stale entry in `active-sessions-<userId>`. Cosmetic — `findSession` still requires the token key itself.

## Rollout

Deploying logs nobody out. Existing sessions have no Redis key, so the first read misses, falls through to Postgres, and succeeds. New sessions populate Redis from then on.

## Testing

**Vitest lands first, in its own PR.** It draws 89.7M weekly npm downloads against Jest's 46.3M and Rstest's 128.9k, ships as v4.1.10 under VoidZero's maintenance, and Next.js 16.3.0 bundles a setup guide at `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`. Rstest remains pre-1.0 at v0.11.6 with roughly 0.14% of Vitest's download volume — too thin to debug alone as a solo developer. All three share the Jest-style API, so revisiting later stays cheap.

Install `vitest` and `vite-tsconfig-paths` for the `~/` alias. Skip `jsdom`, `@vitejs/plugin-react` and testing-library until a component actually needs testing. A test runner and a session-storage rewrite reviewed together means neither is reviewed properly, so this PR carries only the runner.

Unit tests then cover the adapter against a mocked Upstash client:

- `get` re-stringifies an object the REST client already parsed
- `get` returns `null` when the client throws
- `set` swallows a throw
- `increment` returns `0` when the client throws
- `increment` sets the TTL only on first call
- `delete` propagates a throw
- Every method applies the injected prefix

Manual checks cover the wiring. Local dev needs the KV vars pulled (`vercel env pull`):

| Check | Catches | Where |
|---|---|---|
| Sign in, reload — session persists | JSON auto-parse | Local |
| Key TTL is ~604800, not 604800000 | Seconds versus milliseconds | Local |
| Key reads `ba:development:<fingerprint>:<token>` | Prefix isolation | Local |
| Row in `session` **and** key in Redis | Dual-write | Local |
| `DEL` the key — still signed in | **Postgres fallback** | Local |
| Point the adapter at a bad URL — still signed in | Fail-open reads | Local |
| Sign out — key and row both gone | Revoke path | Local |
| No Redis call on a second request within 60s | Cookie cache | Local |
| Two worktrees on different branches don't share a session | DB fingerprint | Local |
| Four rapid sign-ins return 429 | Rate limit storage | **Preview** |

The `DEL` check matters most. It is the only proof the dual-write safety net works rather than merely existing in config.

**The rate limit fix cannot be proven locally.** `rateLimit.enabled` defaults to `isProduction`, and more fundamentally the defect is that a memory counter dies with its lambda — one local Node process has one memory, so the check would pass with the bug still present. It has to run against a preview deployment.

## Follow-ups

**Add detection for silent Redis degradation.** Eviction is confirmed disabled, so Redis rejects writes at capacity rather than dropping session keys. But fail-open `set` and `increment` swallow those rejections, so capacity exhaustion silently reinstates the exact defect this work fixes. No quota alert is configured and there is no telemetry surface in the project, so the only signal is `[auth:redis]` in Vercel runtime logs. Accepted for now; first thing to fix if this carries real users.

**Sweep expired `session` rows.** Dual-write reintroduces table bloat: Redis-first reads mean expired rows are never touched, and Better Auth only deletes a row when someone tries to use it. At current usage that is roughly 52 rows a year, so this is a note rather than a blocker. When it matters, a `schedule:` trigger running `DELETE FROM session WHERE expires_at < now()` fits in `.github/workflows/post-deploy.yml`, which already runs SQL against the database (L96-103). It does **not** require Inngest.

**Separate Upstash database per environment.** For quota and blast radius. The `DATABASE_URL` fingerprint already handles correctness.

## Related ADRs

- [ADR006 — Cache sessions in Upstash Redis with Postgres retained as the durable copy](../../docs/adr/adr006-redis-session-cache-with-postgres-durable-copy.md)
- [ADR007 — Fail open on Redis reads, writes and rate-limit counters, and fail closed on deletes](../../docs/adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md)
