import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "~/server/db";

const runtimeUrl = process.env.V0_RUNTIME_URL;
const vercelUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: undefined;
const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
	? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
	: undefined;

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
