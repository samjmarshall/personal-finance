import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/** @type {<T extends z.ZodType>(schema: T) => T | z.ZodOptional<T>} */
const requiredInProd = (schema) =>
	process.env.NODE_ENV === "production" ? schema : schema.optional();

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		BETTER_AUTH_SECRET: requiredInProd(z.string()),
		BETTER_AUTH_URL: z.preprocess(
			(str) =>
				process.env.VERCEL
					? process.env.VERCEL_ENV === "production"
						? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
						: `https://${process.env.VERCEL_BRANCH_URL}`
					: process.env.PORTLESS_URL
						? process.env.PORTLESS_URL
						: str,
			requiredInProd(z.url()),
		),
		DATABASE_URL: z.url(),
		/**
		 * Direct (non-PgBouncer) connection, used by drizzle-kit for DDL.
		 */
		DATABASE_URL_UNPOOLED: z.url().optional(),
		// The URL of the deployment version, allowing e2e testing against precise deployments.
		DEPLOYMENT_URL: z.preprocess(
			(str) =>
				process.env.VERCEL
					? `https://${process.env.VERCEL_URL}`
					: process.env.PORTLESS_URL
						? process.env.PORTLESS_URL
						: str,
			requiredInProd(z.url()),
		),
		/**
		 * Upstash Redis REST credentials. Names are fixed by Vercel's Upstash
		 * integration, which injects them under `KV_`. Required in production:
		 * without them each lambda rate-limits against its own memory, which a
		 * cold start resets.
		 */
		KV_REST_API_TOKEN: requiredInProd(z.string()),
		KV_REST_API_URL: requiredInProd(z.url()),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
		DEPLOYMENT_URL: process.env.DEPLOYMENT_URL,
		KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
		KV_REST_API_URL: process.env.KV_REST_API_URL,
		NODE_ENV: process.env.NODE_ENV,
	},
	/**
	 * Use `SKIP_ENV_VALIDATION` when skipping env validation is required.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
