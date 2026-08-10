import type { Config } from "drizzle-kit";

import { env } from "~/env";

export default {
	schema: "./src/server/**/*.schema.ts",
	// Explicit even though it matches the default — `drizzle-kit check`
	// misparses the config as an AWS Data API driver without it.
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		// DDL must not go through PgBouncer; fall back for local Docker Postgres.
		url: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
	},
} satisfies Config;
