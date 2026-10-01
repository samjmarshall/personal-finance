import { services } from "~/server/api/services";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * Raw DB handle is temporary: drop it once every router goes through a service.
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
