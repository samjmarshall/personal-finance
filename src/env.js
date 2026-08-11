import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/** Required in production, optional everywhere else. @type {<T extends z.ZodType>(schema: T) => T | z.ZodOptional<T>} */
const requiredInProd = (schema) =>
	process.env.NODE_ENV === "production" ? schema : schema.optional();

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		BETTER_AUTH_SECRET: requiredInProd(z.string()),
		DATABASE_URL: z.url(),
		/**
		 * Direct (non-PgBouncer) connection, used by drizzle-kit for DDL. Optional
		 * because local dev runs Docker Postgres, which has no pooler.
		 */
		DATABASE_URL_UNPOOLED: z.url().optional(),
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
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
		KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
		KV_REST_API_URL: process.env.KV_REST_API_URL,
		NODE_ENV: process.env.NODE_ENV,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
