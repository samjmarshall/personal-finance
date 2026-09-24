import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { after, type NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { traceIdHeaders } from "~/server/observability/current-trace-id";
import { flushTelemetry } from "~/server/observability/flush";

// Echo the root span's trace id so a developer reads it from the Network tab
// and searches PostHog with no round-trip (adr020). The server span is the root
// — the browser sends no traceparent — so this is the id the whole tree shares.
export function traceIdResponseMeta(): { headers: Record<string, string> } {
	return { headers: traceIdHeaders() };
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
