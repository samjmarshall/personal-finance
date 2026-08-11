---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-08-11'
# prettier-ignore
---

# Fail open on Redis session reads, writes and rate-limit counters; fail closed on deletes and the revocation manifest

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

That unconditional `delete` only covers single sign-out. **Bulk revocation has no such line.** `deleteSecondaryStorageSessions` (`internal-adapter.mjs:60-67`) derives the tokens to remove solely from the per-user `active-sessions-<userId>` key:

```js
const activeSession = await secondaryStorage.get(`active-sessions-${userId}`);
const sessions = activeSession ? safeJSONParse(activeSession) : [];
if (!sessions) return;                                  // [] is truthy — no early return
for (const session of sessions) await secondaryStorage.delete(session.token);
```

`deleteUserSessions` then drops every Postgres row regardless. So a `get` that fails open deletes nothing from Redis, wipes the durable copy, and reports success. `deleteSessions` is shaped the same way — `if (await get(token)) await delete(token)` — where a fail-open read skips the delete. Both reach the user through "sign out all devices", change-password-with-revoke, change-email, delete-user and password reset.

The list is therefore not an index. It is the revocation manifest, and it is reachable through the same `get`/`set` that sessions use.

Which adapter operations should convert a Redis failure into a benign result, and which should let it propagate?

## Decision

We will give each operation the posture its fallback supports, rather than a uniform one:

| Operation | On Redis failure | Reasoning |
| --- | --- | --- |
| `get` | Log, return `null` | Presents as a miss, so the Postgres fallback takes over |
| `set` | Log, continue | Postgres already holds the durable row |
| `increment` | Log, return `0` (allowed) | A throw would 500 every browser request to `/api/auth/*` |
| `delete` | **Throw** | Swallowing it creates an authentication bypass |
| `get` / `set` on `active-sessions-*` | **Throw** | The revocation manifest; a swallowed failure makes a live session unrevokable |

The posture is keyed on the operation *and* the key, because the manifest is the one value where a silent miss is not recoverable from Postgres. A failed manifest read aborts bulk revocation before the Postgres delete, so both copies survive and the user can retry. A failed manifest write aborts session creation, because a session missing from the list can never be bulk-revoked afterwards — even against a healthy Redis, and with no error at revocation time to signal it.

Failures are logged by reason only, never by error object. The Upstash client puts our data into its own error messages in two different ways:

- `UpstashError` embeds the entire command (`chunk-K7RP6Y36.mjs:203`) — the key is a raw session token, the value a serialised user record. The adapter truncates at `", command was:"` and keeps Upstash's reason.
- `UpstashJSONParseError` quotes the first 200 characters of the response body (`nodejs.js:53`). It is thrown on the **success** path too (`:271`), where that body is the stored session itself. Nothing in that message is safe, so the adapter logs only the error name.

Logging the raw error would dump session tokens and user PII into Vercel runtime logs on every non-2xx — and adr006's disabled-eviction posture means capacity exhaustion produces exactly that, in bulk.

`getAndDelete` is deliberately not implemented. [adr006](adr006-redis-session-cache-with-postgres-durable-copy.md) sets `verification.storeInDatabase: true`, which routes consumption down Better Auth's Postgres transaction path and leaves `internal-adapter.mjs:695` unreachable. Adding it would be dead code carrying a comment claiming it prevents double-consumption.

Failures log to `console.error` under the `[auth:redis]` prefix.

## Consequences

- A Redis outage degrades session reads and writes to Postgres. Users notice latency, not errors.
- **Rate limiting stops silently** during an outage, and equally at capacity exhaustion: eviction is disabled on the instance, so Redis rejects writes, `set` and `increment` swallow the rejection, and the counter simply stops counting. The defect adr006 exists to fix returns, undetected.
- **Nothing detects that.** No quota alert is configured and the project has no telemetry surface — no Sentry, no PostHog. The only signal is `console.error` under the `[auth:redis]` prefix in Vercel runtime logs, which requires someone to go looking. Accepted deliberately for a pre-PMF prototype; it is the first thing to fix if this ever carries real users.
- Fail-open `increment` means an attacker who can degrade Upstash gets unlimited attempts. Accepted, because rate limiting does not work at all today; the posture loses a defence that is not yet in place rather than one that is.
- A failing sign-out returns an error the user can retry. Because the throw aborts before the Postgres delete, neither copy is removed and the session stays intact and consistent — the failure is visible and recoverable rather than silent and permanent.
- **Sign-in fails while Redis is down.** Session creation writes the manifest, and that write now fails closed, so an outage blocks new sign-ins rather than quietly creating sessions that can never be bulk-revoked. Existing sessions keep working — reads still fall through to Postgres. This is the one place we trade adr006's availability promise for revocation correctness, and it is deliberate: an unrevokable session is permanent, an outage is not.
- Bulk revocation is unavailable during a Redis outage. It returns an error the user can retry, and because the throw aborts before the Postgres delete, both copies survive intact.
- An earlier draft of this record claimed drift in the `active-sessions-<userId>` list was "cosmetic only, because `findSession` still requires the token key itself, which the subsequent `delete` removes or throws on". **That was wrong**, and the error is worth keeping visible: it held only for single sign-out, where `deleteSession` deletes the token key unconditionally. The bulk paths have no such line — they delete only what the list names. The reasoning generalised from one call site to a family of them, which is how a fail-open read became an authentication-bypass vector.
- **Adding a `try`/`catch` to `delete` for consistency creates an authentication bypass.** The asymmetry reads as an oversight and invites exactly that tidy-up. This record is the reason it must not happen.
- The adapter is now the only place that knows Redis can fail, which keeps `config.ts` free of error handling.
- The posture depends on Better Auth's internal key naming (`active-sessions-<userId>`) and on which of its call sites delete unconditionally. Both are private implementation details that a minor upgrade could change silently. `secondary-storage.test.ts` pins the adapter's half of the contract; the Better Auth half is unpinned, so a session-storage change in an upgrade warrants re-reading `internal-adapter.mjs`.
- One revocation path is **not** covered: `deleteSessions` (`internal-adapter.mjs:421`) guards each delete with `if (await get(token)) await delete(token)` on the session-token key, which fails open — a swallowed read skips the delete while the Postgres `deleteMany` still runs, orphaning the Redis key. It is unreachable today: its only callers are in the `multi-session` plugin (`plugins/multi-session/index.mjs:187,209`), which `config.ts` does not enable. **Enabling `multi-session` reopens the bypass** and must be paired with either an unconditional delete or manifest-style fail-closed handling for that path. The token-key `get` cannot fail closed wholesale — it is the same key the hot read path depends on.
