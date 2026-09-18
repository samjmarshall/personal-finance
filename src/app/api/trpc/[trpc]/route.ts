import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { after, type NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { flushTelemetry } from "~/server/observability/flush";
import { createRootLogger } from "~/server/observability/logger";

// Root composition point for the tRPC route — builds its own logger.
const logger = createRootLogger().with({ domain: "trpc", component: "route" });

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
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		onError:
			env.NODE_ENV === "development"
				? ({ path, error }) => {
						logger.error("trpc handler error", { error, "trpc.path": path });
					}
				: undefined,
	});
};

export { handler as GET, handler as POST };
