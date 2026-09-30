import { services } from "~/server/api/services";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * Per-request tRPC context; the API handler and the RSC caller each wrap it.
 * `db` stays until every router reads through `services` (migration step 7).
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	const session = await auth.api.getSession({
		headers: opts.headers,
	});
	return {
		db,
		session,
		services,
		...opts,
	};
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
