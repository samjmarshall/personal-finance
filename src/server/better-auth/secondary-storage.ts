import { Redis } from "@upstash/redis";

type Options = {
	url: string;
	token: string;
	/** Namespaces every key — Better Auth keys are raw tokens with no namespace of their own. */
	prefix: string;
};

/**
 * Better Auth's per-user list of live session tokens.
 *
 * Bulk revocation (`deleteUserSessions`) reads this key, deletes only the tokens it
 * names, then drops every Postgres row regardless — so losing it silently leaves
 * orphan Redis keys that authenticate for the session's full TTL with no row left to
 * revoke. It is the revocation manifest, not an index, and must not fail open.
 */
const isRevocationManifest = (key: string) =>
	key.startsWith("active-sessions-");

/**
 * Upstash's reason for a failure, with our data stripped out.
 *
 * `UpstashError` appends the whole command — the key is a raw session token, the
 * value a serialised user record. `UpstashJSONParseError` quotes 200 chars of the
 * response body and is thrown on the *success* path too, where that body is the
 * session itself, so nothing in it is safe and only the name survives.
 */
function redactReason(error: unknown) {
	const name = error instanceof Error ? error.name : typeof error;
	if (name === "UpstashJSONParseError") return name;
	const message = error instanceof Error ? error.message : String(error);
	return message.split(", command was:")[0];
}

/**
 * Redacted stand-in, safe to throw out of this module.
 *
 * Better Auth logs whatever we throw as a whole error object (`api/index.mjs:210`,
 * `routes/sign-out.mjs:24`), and its logger hands that to `console.error` — so
 * rethrowing Upstash's own error would put the session token and user record into
 * Vercel's runtime logs and defeat the redaction above. Carries no `cause`: Node's
 * inspector prints that too.
 */
class RedisUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RedisUnavailableError";
	}
}

/** Logs the redacted reason; returns the error to rethrow on fail-closed paths. */
function fail(operation: string, error: unknown) {
	const reason = redactReason(error);
	console.error(`[auth:redis] ${operation} failed`, reason);
	return new RedisUnavailableError(
		`[auth:redis] ${operation} failed: ${reason}`,
	);
}

/**
 * Better Auth secondary storage over Upstash Redis. TTLs in seconds.
 *
 * Session reads, writes and rate-limit increments fail open — Postgres holds the
 * durable copy, so a Redis outage degrades to a slower sign-in, not a signed-out user.
 * `delete` and every revocation-manifest access fail closed: those are the paths where
 * swallowing an error would leave a live session nobody can revoke. See adr007.
 */
export function createSecondaryStorage({ url, token, prefix }: Options) {
	const redis = new Redis({ url, token });
	const k = (key: string) => prefix + key;

	return {
		get: async (key: string) => {
			try {
				const value = await redis.get(k(key));
				if (value === null || value === undefined) return null;
				// The Upstash REST client parses JSON for us; Better Auth expects a string.
				return typeof value === "string" ? value : JSON.stringify(value);
			} catch (error) {
				const failure = fail("get", error);
				if (isRevocationManifest(key)) throw failure;
				return null; // Presents as a miss, so the Postgres fallback runs.
			}
		},

		set: async (key: string, value: string, ttl?: number) => {
			// A TTL of 0 means already expired, not "keep forever": `getTTLSeconds`
			// floors at 0 and callers pass it straight through (`internal-adapter.mjs:37`).
			// Writing it without `ex` leaves a key nothing ever reclaims — eviction is
			// disabled on the instance, and only the TTL removes session keys.
			if (ttl !== undefined && ttl <= 0) return;
			try {
				if (ttl === undefined) await redis.set(k(key), value);
				else await redis.set(k(key), value, { ex: ttl });
			} catch (error) {
				const failure = fail("set", error);
				if (isRevocationManifest(key)) throw failure;
			}
		},

		// This catch RETHROWS. It exists only to redact the error, never to swallow it —
		// letting Better Auth delete the Postgres row after a failed Redis delete leaves
		// an orphan key that authenticates for up to 7 days. See adr007.
		delete: async (key: string) => {
			try {
				await redis.del(k(key));
			} catch (error) {
				throw fail("delete", error);
			}
		},

		increment: async (key: string, ttl: number) => {
			try {
				// One round trip, and `NX` sets the TTL whenever it is missing. Issuing
				// EXPIRE separately leaks a TTL-less counter if it fails after the INCR,
				// which 429s that IP forever — nothing else deletes rate-limit keys.
				const [count] = await redis
					.pipeline()
					.incr(k(key))
					.expire(k(key), ttl, "NX")
					.exec<[number, 0 | 1]>();
				return count;
			} catch (error) {
				fail("increment", error);
				return 0; // Allowed. A throw 500s every /api/auth/* request.
			}
		},
	};
}
