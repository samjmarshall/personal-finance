import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";
import { createSecondaryStorage } from "./secondary-storage";

const runtimeUrl = process.env.V0_RUNTIME_URL;
const vercelUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: undefined;
const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
	? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
	: undefined;

/**
 * Binds cached sessions to the database that issued them. Every environment and
 * every Neon branch shares one Upstash database, so without this a session token
 * minted against one set of Postgres rows would resolve against another.
 * `VERCEL_ENV` is read raw — Vercel's own vars are not ours to validate.
 */
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

if (!secondaryStorage && process.env.NODE_ENV !== "production") {
	console.warn(
		"[auth:redis] KV not configured — sessions falling back to Postgres",
	);
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	baseURL:
		process.env.BETTER_AUTH_URL ?? productionUrl ?? vercelUrl ?? runtimeUrl,
	trustedOrigins: [
		"http://localhost:3000",
		// v0 preview + build sandboxes are served from dynamic subdomains.
		"https://*.vercel.run",
		"https://*.v0.build",
		...(runtimeUrl ? [runtimeUrl] : []),
		...(vercelUrl ? [vercelUrl] : []),
		...(productionUrl ? [productionUrl] : []),
	],
	emailAndPassword: {
		enabled: true,
		autoSignIn: true,
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
