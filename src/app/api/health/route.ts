import { sql } from "drizzle-orm";

import { db } from "~/server/db";

// A readiness probe the promote gate curls before flipping the production alias:
// it must reach the db at request time, so opt out of any build-time evaluation
// or caching that would run `select 1` during `next build` (no db there).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
	try {
		await db.execute(sql`select 1`);
		return Response.json({ status: "ok" }, { status: 200 });
	} catch (error) {
		console.error("[health] readiness check failed", error);
		return Response.json({ status: "error" }, { status: 503 });
	}
}
