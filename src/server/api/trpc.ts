/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import superjson from "superjson";
import { flattenError, ZodError } from "zod";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { BaggageKey } from "~/server/observability/baggage";
import { createRootLogger } from "~/server/observability/logger";
import { reportError } from "~/server/observability/report-error";
import { failSpan, withSpan } from "~/server/observability/tracer";

// Composition root: builds its own logger + tracer. Middleware has no injection
// point, so it takes the adr004 root exception route files also take.
const logger = createRootLogger().with({ domain: "trpc" });

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
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
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? flattenError(error.cause) : null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Simulates production network latency in dev only, so local work surfaces the
 * waterfalls a fast localhost hides.
 */
const devLatencyMiddleware = t.middleware(async ({ next }) => {
	if (t._config.isDev) {
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
	return next();
});

// Routine client faults — a signed-out tab polling a protected query, a probe on
// a missing route. Tag the code but don't fail the span or log, or normal traffic
// spams Error Tracking and drowns real failures. Zod BAD_REQUEST stays a warn.
const EXPECTED_ERROR_CODES = new Set([
	"UNAUTHORIZED",
	"FORBIDDEN",
	"NOT_FOUND",
]);

/**
 * Member stamped on baggage before auth so every downstream span/log carries it.
 * Duration lives on the span, not a log — 500s are also sent to Error Tracking.
 */
const observabilityMiddleware = t.middleware(
	async ({ ctx, next, path, type }) => {
		return withSpan(
			`trpc.${path}`,
			{
				attributes: { "trpc.type": type, "trpc.path": path },
				baggage: { [BaggageKey.MemberId]: ctx.session?.user?.id },
			},
			async (span) => {
				const result = await next();

				if (!result.ok) {
					try {
						// Every failure keeps its code for counting; expected client
						// faults stop there — see EXPECTED_ERROR_CODES above.
						span.setAttribute("trpc.error_code", result.error.code);

						if (!EXPECTED_ERROR_CODES.has(result.error.code)) {
							failSpan(span, result.error);

							if (getHTTPStatusCodeFromError(result.error) >= 500) {
								reportError(logger, "trpc internal error", result.error, {
									"trpc.path": path,
								});
							} else {
								logger.warn("trpc request failed", {
									"trpc.path": path,
									"trpc.error_code": result.error.code,
								});
							}
						}
					} catch (error) {
						console.error("observability_failed", {
							"trpc.path": path,
							"trpc.error_code": result.error.code,
							error,
						});
					}
				}

				return result;
			},
		);
	},
);

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
	.use(devLatencyMiddleware)
	.use(observabilityMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
	.use(devLatencyMiddleware)
	.use(observabilityMiddleware)
	.use(({ ctx, next }) => {
		if (!ctx.session?.user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		return next({
			ctx: {
				// infers the `session` as non-nullable
				session: { ...ctx.session, user: ctx.session.user },
			},
		});
	});
