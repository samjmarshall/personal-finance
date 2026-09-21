import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { after, type NextRequest } from "next/server";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { flushTelemetry } from "~/server/observability/flush";

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
	});
};

export { handler as GET, handler as POST };
