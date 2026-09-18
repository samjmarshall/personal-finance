/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { flattenError, ZodError } from "zod";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { setBaggage } from "~/server/observability/baggage";
import { createRootLogger } from "~/server/observability/logger";
import { captureException } from "~/server/observability/posthog";

// Core wiring, a root — builds its own logger/tracer, same adr004 exception route
// files make. Tiers receive an injected `logger`; middleware has no DI seam.
const logger = createRootLogger().with({ domain: "trpc" });
const tracer = trace.getTracer(env.PROJECT_NAME);

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
 * waterfalls a fast localhost hides. Outside the trace span (adr015 Decision 16):
 * the delay is a dev artefact, not real request time.
 */
const devLatencyMiddleware = t.middleware(async ({ next }) => {
	if (t._config.isDev) {
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
	return next();
});

/**
 * Opens the `trpc.<path>` span that roots the request trace and puts the Member on
 * baggage before the auth check, so downstream spans/logs carry it. Duration lives
 * on the span, not a log line; a failed call records the code and a 500 is also
 * sent to Error Tracking.
 */
const tracingMiddleware = t.middleware(async ({ ctx, next, path, type }) =>
	tracer.startActiveSpan(
		`trpc.${path}`,
		{ attributes: { "trpc.type": type, "trpc.path": path } },
		async (span) => {
			const baggageCtx = setBaggage({ "member.id": ctx.session?.user?.id });
			try {
				return await context.with(baggageCtx, async () => {
					const result = await next();
					if (!result.ok) {
						span.setAttribute("trpc.error_code", result.error.code);
						span.recordException(result.error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						if (result.error.code === "INTERNAL_SERVER_ERROR") {
							captureException(result.error, { "trpc.path": path });
							logger.error("trpc internal error", {
								error: result.error,
								"trpc.path": path,
							});
						} else {
							logger.warn("trpc request failed", {
								"trpc.path": path,
								"trpc.error_code": result.error.code,
							});
						}
					}
					return result;
				});
			} finally {
				span.end();
			}
		},
	),
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
	.use(tracingMiddleware);

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
	.use(tracingMiddleware)
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
