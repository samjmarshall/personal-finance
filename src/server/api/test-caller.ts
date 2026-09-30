import type { TRPCBuiltRouter, TRPCRouterRecord } from "@trpc/server";

import type { Context } from "~/server/api/context";
import type { Services } from "~/server/api/services";
import { createCallerFactory, type createTRPCRouter } from "~/server/api/trpc";

type Root = ReturnType<typeof createTRPCRouter>["_def"]["_config"]["$types"];
type SessionUser = NonNullable<Context["session"]>["user"];

export interface TestCallerOptions {
	services?: { [K in keyof Services]?: Partial<Services[K]> };
	/** Defaults to Member `member-1`; `null` is signed out. */
	session?: { user: Partial<SessionUser> & { id: string } } | null;
}

/**
 * Calls a router with fake services and no `vi.mock`. Passes no `db`, so a
 * procedure still reading `ctx.db` fails loudly.
 */
export function createTestCaller<TRecord extends TRPCRouterRecord>(
	router: TRPCBuiltRouter<Root, TRecord>,
	{
		services = {},
		session = { user: { id: "member-1" } },
	}: TestCallerOptions = {},
) {
	// The one cast: fakes are partial and `db` is left out on purpose.
	return createCallerFactory(router)({
		services,
		session,
		headers: new Headers(),
	} as never);
}
