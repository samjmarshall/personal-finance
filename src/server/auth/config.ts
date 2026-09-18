import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { env } from "~/env";
import { db } from "~/server/db";
import { createRootLogger } from "~/server/observability/logger";
import { createSecondaryStorage } from "./secondary-storage";

const logger = createRootLogger().with({ domain: "auth" });

/**
 * Binds cached sessions to the database that issued them. Every environment and
 * every Neon branch shares one Upstash database, so without this a session token
 * minted against one set of Postgres rows would resolve against another.
 * `VERCEL_ENV` is read raw — Vercel's own vars are not ours to validate.
 */
const dbFingerprint = createHash("sha256")
	// `?? ""` because `SKIP_ENV_VALIDATION` hands back `process.env` unvalidated, and
	// `update(undefined)` throws at import — taking down every module that imports `auth`.
	.update(env.DATABASE_URL ?? "")
	.digest("hex")
	.slice(0, 8);
const redisKeyPrefix = `ba:${process.env.VERCEL_ENV ?? "development"}:${dbFingerprint}:`;

const secondaryStorage =
	env.KV_REST_API_URL && env.KV_REST_API_TOKEN
		? createSecondaryStorage({
				url: env.KV_REST_API_URL,
				token: env.KV_REST_API_TOKEN,
				prefix: redisKeyPrefix,
			})
		: undefined;

if (!secondaryStorage) {
	// Loudest in production, where it is a defect rather than the normal local state:
	// rate limiting falls back to per-lambda memory and every session read hits Neon.
	const level = process.env.NODE_ENV === "production" ? "error" : "warn";
	logger[level]("KV not configured — sessions falling back to Postgres", {
		"event.name": "auth.kv.missing",
	});
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	baseURL: env.BETTER_AUTH_URL,
	// The deployment URL is used for e2e testing as it is an exact version of the app.
	trustedOrigins: env.DEPLOYMENT_URL ? [env.DEPLOYMENT_URL] : [],
	emailAndPassword: {
		enabled: true,
		autoSignIn: true,
		// Sign up disabled in production until data is partitioned by household; the DB is shared across all users today.
		disableSignUp: env.NODE_ENV === "production",
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		// Dual-write. `preserveSessionInDatabase` stays unset: only its `false`
		// default lets a Redis miss fall through to Postgres rather than resolve
		// as signed-out. See adr006.
		storeSessionInDatabase: true,
		cookieCache: { enabled: true, maxAge: 60 },
	},
	verification: { storeInDatabase: true },
	secondaryStorage,
	// Must track `secondaryStorage`. Naming "secondary-storage" with none wired
	// does not degrade to memory — the counter reads back empty every time and
	// every request is allowed, silently disabling the limiter outright.
	rateLimit: { storage: secondaryStorage ? "secondary-storage" : "memory" },
	hooks: {
		// Revoke before the endpoint runs, because `/sign-out` swallows whatever
		// `deleteSession` throws, clears the cookie and still answers `success: true`
		// (`routes/sign-out.mjs:21-27`). A failed Redis delete aborts before the Postgres
		// delete, so the session stays fully live while the user is told it is gone —
		// and with the cookie cleared they cannot retry. Doing it here surfaces the
		// failure instead. The endpoint's own call then finds the key already gone.
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== "/sign-out" || !secondaryStorage) return;
			const token = await ctx.getSignedCookie(
				ctx.context.authCookies.sessionToken.name,
				ctx.context.secret,
			);
			if (!token) return;
			try {
				await ctx.context.internalAdapter.deleteSession(token);
			} catch (error) {
				// Name only. The adapter already logged its own redacted reason, and a
				// Postgres failure here carries the session token in the query params —
				// the thing adr007 keeps out of runtime logs. Passing `error` would ship
				// its message/stack to PostHog; the name alone still tells a Redis outage
				// from a database one.
				logger.error("sign-out revocation failed", {
					"error.name": error instanceof Error ? error.name : typeof error,
				});
				throw new APIError("INTERNAL_SERVER_ERROR", {
					message: "Could not sign out. Please try again.",
				});
			}
		}),
	},
	...(process.env.NODE_ENV === "development"
		? {
				advanced: {
					defaultCookieAttributes: {
						sameSite: "none" as const,
						secure: true,
					},
				},
			}
		: {}),
});

export type Session = typeof auth.$Infer.Session;
