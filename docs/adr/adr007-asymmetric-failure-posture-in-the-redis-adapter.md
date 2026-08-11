---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-08-11'
# prettier-ignore
---

# Fail open on Redis reads, writes and rate-limit counters, and fail closed on deletes

Design: [2026-08-11 Better Auth secondary storage on Upstash Redis](../../thoughts/designs/2026-08-11-better-auth-upstash-secondary-storage.md)

## Context

[adr006](adr006-redis-session-cache-with-postgres-durable-copy.md) makes Redis a cache over Postgres, which only works if a Redis failure presents to Better Auth as a **miss**. Better Auth does not make that conversion itself. It never wraps a `secondaryStorage` call in `try`/`catch`; the only guarded blocks in `internal-adapter.mjs` protect `JSON.parse`. An Upstash error therefore propagates, the request returns 500, and the Postgres fallback the previous ADR depends on never runs.

The same is true on the rate limit path. `onRequestRateLimit` awaits `storage.consume(key, rule)` bare (`node_modules/better-auth/dist/api/rate-limiter/index.mjs:343`), and `consume` delegates straight to the adapter's `increment`. That hook runs in the router's `onRequest` (`api/index.mjs:168`), so it covers every HTTP request to `/api/auth/*` — including the default global rule of 100 requests per 10 seconds on all paths. Server-side `auth.api.getSession` calls from tRPC and RSC bypass the router and are unaffected.

Deletion is shaped differently. `internal-adapter.mjs:393-395` removes the Redis key first and the Postgres row second:

```js
await secondaryStorage.delete(token);
if (databaseStoresSessions && !preservesDatabaseSessions) await deleteWithHooks(...);
```

Swallowing an error from the first line lets the second run. The Postgres row disappears, the Redis key survives, and `findSession` checks Redis first — so a revoked session keeps authenticating with no database row left to contradict it, until its TTL expires up to seven days later.

Which adapter operations should convert a Redis failure into a benign result, and which should let it propagate?

## Decision

We will give each operation the posture its fallback supports, rather than a uniform one:

| Operation | On Redis failure | Reasoning |
| --- | --- | --- |
| `get` | Log, return `null` | Presents as a miss, so the Postgres fallback takes over |
| `set` | Log, continue | Postgres already holds the durable row |
| `increment` | Log, return `0` (allowed) | A throw would 500 every browser request to `/api/auth/*` |
| `delete` | **Throw** | Swallowing it creates an authentication bypass |

`getAndDelete` is deliberately not implemented. [adr006](adr006-redis-session-cache-with-postgres-durable-copy.md) sets `verification.storeInDatabase: true`, which routes consumption down Better Auth's Postgres transaction path and leaves `internal-adapter.mjs:695` unreachable. Adding it would be dead code carrying a comment claiming it prevents double-consumption.

Failures log to `console.error` under the `[auth:redis]` prefix.

## Consequences

- A Redis outage degrades session reads and writes to Postgres. Users notice latency, not errors.
- **Rate limiting stops silently** during an outage, and equally at capacity exhaustion: eviction is disabled on the instance, so Redis rejects writes, `set` and `increment` swallow the rejection, and the counter simply stops counting. The defect adr006 exists to fix returns, undetected.
- **Nothing detects that.** No quota alert is configured and the project has no telemetry surface — no Sentry, no PostHog. The only signal is `console.error` under the `[auth:redis]` prefix in Vercel runtime logs, which requires someone to go looking. Accepted deliberately for a pre-PMF prototype; it is the first thing to fix if this ever carries real users.
- Fail-open `increment` means an attacker who can degrade Upstash gets unlimited attempts. Accepted, because rate limiting does not work at all today; the posture loses a defence that is not yet in place rather than one that is.
- A failing sign-out returns an error the user can retry. Because the throw aborts before the Postgres delete, neither copy is removed and the session stays intact and consistent — the failure is visible and recoverable rather than silent and permanent.
- The per-user `active-sessions-<userId>` list can drift. `deleteSession` reads it through the fail-open `get`, so a read failure skips list cleanup and leaves a stale token entry. Cosmetic only: `findSession` still requires the token key itself, which the subsequent `delete` removes or throws on.
- **Adding a `try`/`catch` to `delete` for consistency creates an authentication bypass.** The asymmetry reads as an oversight and invites exactly that tidy-up. This record is the reason it must not happen.
- The adapter is now the only place that knows Redis can fail, which keeps `config.ts` free of error handling.
