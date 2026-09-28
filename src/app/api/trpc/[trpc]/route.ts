import type { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext, trpcLogger } from "~/server/api/trpc";
import { reportError } from "~/server/observability/errors/report-error";
import { withFlush } from "~/server/observability/sdk/flush";
import { traceIdHeaders } from "~/server/observability/tracing/current-trace-id";

// A batch builds its context once, then every call in it rethrows that one
// error. Report it once, not once per call.
const reportedErrors = new WeakSet<TRPCError>();

// The middleware logs every procedure error. A failure before any procedure runs
// (bad request body, session lookup) never reaches it, so it would vanish.
export function reportPreProcedureError({
	error,
	ctx,
	path,
}: {
	error: TRPCError;
	ctx: unknown;
	path: string | undefined;
}): void {
	if (ctx !== undefined || getHTTPStatusCodeFromError(error) < 500) return;
	if (reportedErrors.has(error)) return;
	reportedErrors.add(error);
	reportError(trpcLogger, "trpc request failed before procedure", error, {
		"trpc.path": path,
	});
}

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
	return createTRPCContext({
		headers: req.headers,
	});
};

const handler = withFlush((req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		// Echo the trace id so a developer reads it from the Network tab (adr020).
		// The server span is the root, so it's the id the whole tree shares.
		responseMeta: () => ({ headers: traceIdHeaders() }),
		onError: reportPreProcedureError,
	}),
);

export { handler as GET, handler as POST };
