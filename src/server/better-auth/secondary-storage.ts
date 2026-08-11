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
 * Logs why a call failed, never what it carried.
 *
 * Our keys are raw session tokens and our values are serialised user records, and the
 * Upstash client puts both into error messages: `UpstashError` appends the whole
 * command, and `UpstashJSONParseError` quotes 200 chars of the response body — which on
 * a successful GET *is* the session. So a parse failure yields nothing safe to print.
 */
function logFailure(operation: string, error: unknown) {
	const name = error instanceof Error ? error.name : typeof error;
	const message = error instanceof Error ? error.message : String(error);
	const reason =
		name === "UpstashJSONParseError"
			? name
			: message.split(", command was:")[0];
	console.error(`[auth:redis] ${operation} failed`, reason);
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
				logFailure("get", error);
				if (isRevocationManifest(key)) throw error;
				return null; // Presents as a miss, so the Postgres fallback runs.
			}
		},

		set: async (key: string, value: string, ttl?: number) => {
			try {
				if (ttl) await redis.set(prefix + key, value, { ex: ttl });
				else await redis.set(prefix + key, value);
			} catch (error) {
				logFailure("set", error);
				if (isRevocationManifest(key)) throw error;
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
				logFailure("increment", error);
				return 0; // Allowed. A throw 500s every /api/auth/* request.
			}
		},
	};
}
