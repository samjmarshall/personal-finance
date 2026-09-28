import { sql } from "drizzle-orm";

import { db } from "~/server/db";
import { errorName } from "~/server/observability/errors/thrown";
import { createRootLogger } from "~/server/observability/logging/logger";

// A readiness probe the promote gate curls before flipping the production alias:
// it must reach the db at request time, so opt out of any build-time evaluation
// or caching that would run `select 1` during `next build` (no db there).
export const dynamic = "force-dynamic";

const logger = createRootLogger().with({
	domain: "health",
	component: "route",
});

export async function GET(): Promise<Response> {
	try {
		await db.execute(sql`select 1`);
		return Response.json({ status: "ok" }, { status: 200 });
	} catch (error) {
		// Name only, never the error itself (adr007): a driver error's message/stack can
		// carry the connection string, and logger.error still ships both to PostHog.
		logger.error("readiness check failed", {
			"error.name": errorName(error),
			"event.name": "health.readiness.failed",
		});
		return Response.json({ status: "error" }, { status: 503 });
	}
}
