import type { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { traceIdHeaders } from "~/server/observability/current-trace-id";
import { flushAfterResponse } from "~/server/observability/flush";
import { createRootLogger } from "~/server/observability/logger";
import { captureException } from "~/server/observability/posthog";

const logger = createRootLogger().with({ domain: "trpc" });

// A batch builds its context once, then every call in it rethrows that one
// error. Report it once, not once per call.
const reportedContextErrors = new WeakSet<TRPCError>();

// The middleware logs every procedure error. A failed context build (the session
// lookup) never reaches it, so without this it would vanish: no log, no issue.
export function reportContextFailure({
	error,
	ctx,
	path,
}: {
	error: TRPCError;
	ctx: unknown;
	path: string | undefined;
}): void {
	if (ctx !== undefined || getHTTPStatusCodeFromError(error) < 500) return;
	if (reportedContextErrors.has(error)) return;
	reportedContextErrors.add(error);
	captureException(error, { "trpc.path": path });
	logger.error("trpc context failed", { error, "trpc.path": path });
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

const handler = (req: NextRequest) => {
	flushAfterResponse();
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		// Echo the trace id so a developer reads it from the Network tab (adr020).
		// The server span is the root, so it's the id the whole tree shares.
		responseMeta: () => ({ headers: traceIdHeaders() }),
		onError: reportContextFailure,
	});
};

export { handler as GET, handler as POST };
