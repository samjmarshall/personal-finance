/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS you want a new middleware or type of
 * procedure (see Part 2). Request context lives in `context.ts`.
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 *
 * The context is imported as a type only, so loading this file (and so any router) never loads
 * db or auth — router tests need no stubs.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import superjson from "superjson";
import { flattenError, ZodError } from "zod";

import type { Context } from "~/server/api/context";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import { reportError } from "~/server/observability/errors/report-error";
import { createRootLogger } from "~/server/observability/logging/logger";
import { BaggageKey } from "~/server/observability/tracing/baggage";
import { failSpan, withSpan } from "~/server/observability/tracing/tracer";

// Composition root: builds its own logger + tracer. Middleware has no injection
// point, so it takes the adr004 root exception route files also take. Shared
// with the tRPC route so both halves of tRPC log under one binding.
export const trpcLogger = createRootLogger().with({ domain: "trpc" });

/**
 * 1. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<Context>().create({
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
 * 2. ROUTER & PROCEDURE (THE IMPORTANT BIT)
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
								reportError(trpcLogger, "trpc internal error", result.error, {
									"trpc.path": path,
								});
							} else {
								trpcLogger.warn("trpc request failed", {
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
 * Services throw transport-free domain errors; this is the one place they become
 * codes. Sits inside observability so spans and logs see the mapped code.
 * Only a raw throw (tRPC wraps it as a 500) is mapped; a deliberate TRPCError
 * keeps its code even if its cause is a domain error.
 */
const errorMappingMiddleware = t.middleware(async ({ next }) => {
	const result = await next();
	if (result.ok || result.error.code !== "INTERNAL_SERVER_ERROR") return result;
	const { cause } = result.error;
	if (cause instanceof NotFoundError) throw mappedError("NOT_FOUND", cause);
	if (cause instanceof ConflictError) throw mappedError("CONFLICT", cause);
	if (cause instanceof InvalidInputError) {
		throw mappedError("BAD_REQUEST", cause);
	}
	return result;
});

function mappedError(code: TRPCError["code"], cause: Error): TRPCError {
	const error = new TRPCError({ code, message: cause.message, cause });
	// Keep the real throw site, as tRPC's own wrap does, or traces point here.
	if (cause.stack) error.stack = cause.stack;
	return error;
}

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure
	.use(devLatencyMiddleware)
	.use(observabilityMiddleware)
	.use(errorMappingMiddleware);

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
	.use(errorMappingMiddleware)
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
