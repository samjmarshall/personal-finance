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
		/** Claude API key. Powers the process-receipt worker's Vision extraction. */
		ANTHROPIC_API_KEY: requiredInProd(z.string()),
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
		/**
		 * Vercel Blob read/write token. Mints upload tokens in the Blob route and
		 * deletes blobs on receipt delete. Injected by Vercel's Blob integration in
		 * prod; set locally to exercise uploads.
		 */
		BLOB_READ_WRITE_TOKEN: requiredInProd(z.string()),
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
		 * Inngest Cloud credentials. The local Dev Server needs neither (it
		 * auto-detects dev), so both are optional outside production.
		 */
		INNGEST_EVENT_KEY: requiredInProd(z.string()),
		INNGEST_SIGNING_KEY: requiredInProd(z.string()),
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
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
		DEPLOYMENT_URL: process.env.DEPLOYMENT_URL,
		INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
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
