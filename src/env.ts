import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { isBranchPrefix } from "./server/blob-store/blob-prefix";

/**
 * Log severity levels (debug→error). Defined here as the single source: env.ts is
 * compiled by Next's config transpiler (next.config.ts imports it), which can't
 * resolve a deep `~` import out of it — so env.ts imports internal files only by
 * relative path, and only ones with no imports of their own (`blob-prefix.ts`).
 * `logger.ts` re-exports this as the public logging name for logging code.
 */
export enum LogLevel {
	DEBUG = "debug",
	INFO = "info",
	WARN = "warn",
	ERROR = "error",
}

const requiredInProd = <T extends z.ZodType>(
	schema: T,
): T | z.ZodOptional<T> =>
	process.env.NODE_ENV === "production" ? schema : schema.optional();

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		/** Bedrock region. Terraform sets it on Vercel; `assume <profile>` exports it locally. */
		AWS_REGION: z.string().default("ap-southeast-2"),
		/**
		 * Vercel only: IAM role the OIDC token is exchanged for (src/server/aws/credentials.ts).
		 * Unset locally; `assume` supplies AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN instead.
		 */
		AWS_ROLE_ARN: z.string().optional(),
		/**
		 * Bedrock inference profile for receipt extraction. Bare `anthropic.*` ids are not
		 * invocable. Switch models in infrastructure/locals.tf, not here.
		 */
		BEDROCK_RECEIPT_MODEL: z.string().default("au.anthropic.claude-sonnet-4-6"),
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
		/**
		 * Names the same Neon branch as DATABASE_URL (adr028): `local/<branch>/` or
		 * `preview/<branch>/`, else `""`. Forced `""` on production. A preview without
		 * one would delete production's files, so it fails the build.
		 */
		BLOB_PATH_PREFIX: z.preprocess(
			(str) => (process.env.VERCEL_ENV === "production" ? "" : (str ?? "")),
			z
				.string()
				.refine(
					(prefix) => prefix === "" || isBranchPrefix(prefix),
					"must be local/<branch>/ or preview/<branch>/",
				)
				.refine(
					(prefix) =>
						process.env.VERCEL_ENV !== "preview" ||
						prefix.startsWith("preview/"),
					"must be preview/<branch>/ on a preview deploy",
				),
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
		/**
		 * Resend inbound credentials. The API key fetches the body and attachment
		 * bytes the `email.received` webhook omits; the webhook secret is the Svix
		 * signing key that decides whether a POST to the inbound route is Resend at
		 * all — without it the route is an open door, so both are required in prod.
		 */
		RESEND_API_KEY: requiredInProd(z.string()),
		/**
		 * The address members forward receipts to. Display-only — shown on Settings
		 * so a member knows where to send; nothing routes on it.
		 */
		RESEND_INBOUND_ADDRESS: z.string().optional(),
		RESEND_WEBHOOK_SECRET: requiredInProd(z.string()),
		/**
		 * Project name. Sourced from package.json `name` (not process.env) — the
		 * single source for the Inngest app id + OTel service name.
		 */
		PROJECT_NAME: z.string().min(1),
		/**
		 * PostHog project token for the project. Must start with `phc_`; a
		 * personal `phx_` key intentionally fails. Unset: OTel registration skipped,
		 * logger writes stdout only, captureException is a no-op.
		 */
		POSTHOG_KEY: z.string().startsWith("phc_").optional(),
		POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
		// PostHog UI host for the trace-viewer deep-link — distinct from POSTHOG_HOST,
		// which is the ingest endpoint (`us.i.` swallows browser navigations).
		POSTHOG_UI_HOST: z.url().default("https://us.posthog.com"),
		POSTHOG_PROJECT_ID: z.string().optional(),
		LOG_LEVEL: z.enum(LogLevel).default(LogLevel.INFO),
		/** Bedrock USD price per single token (not per 1M), stamped on AI spans. Terraform sets it on Vercel. */
		BEDROCK_INPUT_TOKEN_PRICE_USD: z.coerce.number().positive().optional(),
		BEDROCK_OUTPUT_TOKEN_PRICE_USD: z.coerce.number().positive().optional(),
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
		AWS_REGION: process.env.AWS_REGION,
		AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
		BEDROCK_RECEIPT_MODEL: process.env.BEDROCK_RECEIPT_MODEL,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
		BLOB_PATH_PREFIX: process.env.BLOB_PATH_PREFIX,
		DATABASE_URL: process.env.DATABASE_URL,
		DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
		DEPLOYMENT_URL: process.env.DEPLOYMENT_URL,
		INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
		INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
		KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
		KV_REST_API_URL: process.env.KV_REST_API_URL,
		NODE_ENV: process.env.NODE_ENV,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		RESEND_INBOUND_ADDRESS: process.env.RESEND_INBOUND_ADDRESS,
		RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
		PROJECT_NAME: pkg.name,
		POSTHOG_KEY: process.env.POSTHOG_KEY,
		POSTHOG_HOST: process.env.POSTHOG_HOST,
		POSTHOG_UI_HOST: process.env.POSTHOG_UI_HOST,
		POSTHOG_PROJECT_ID: process.env.POSTHOG_PROJECT_ID,
		LOG_LEVEL: process.env.LOG_LEVEL,
		BEDROCK_INPUT_TOKEN_PRICE_USD: process.env.BEDROCK_INPUT_TOKEN_PRICE_USD,
		BEDROCK_OUTPUT_TOKEN_PRICE_USD: process.env.BEDROCK_OUTPUT_TOKEN_PRICE_USD,
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
