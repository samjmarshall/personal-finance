import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "~/server/db";
import { errorName } from "~/server/observability/errors/thrown";
import { createRootLogger } from "~/server/observability/logging/logger";

const logger = createRootLogger().with({
	domain: "health",
	component: "route",
});

// A readiness probe the promote gate curls before flipping the production alias.
export async function GET(): Promise<Response> {
	// It must reach the db per request, never prerender `select 1` at `next build`
	// (no db there). Outside the try: a catch would swallow the prerender bail-out.
	await connection();
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
