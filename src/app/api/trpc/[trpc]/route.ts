import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { after, type NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { currentTraceId } from "~/server/observability/current-trace-id";
import { flushTelemetry } from "~/server/observability/flush";

// Echo the active span's trace id so a developer reads it from the Network tab
// and searches PostHog with no round-trip (adr018). The client's traceparent is
// the trace root, so this id equals the one the browser sent.
export function traceIdResponseMeta(): { headers?: Record<string, string> } {
	const traceId = currentTraceId();
	return traceId ? { headers: { "x-trace-id": traceId } } : {};
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
	// Drain telemetry after the response is sent, before the lambda freezes (adr015 §8).
	after(flushTelemetry);
	// No onError — the tracing middleware is the single place tRPC errors are
	// logged, with the right trace id. A handler-level log would just duplicate it.
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		responseMeta: traceIdResponseMeta,
	});
};

export { handler as GET, handler as POST };
