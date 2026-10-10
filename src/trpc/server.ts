import "server-only";

import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { headers } from "next/headers";
import { cache } from "react";

import { createTRPCContext } from "~/server/api/context";
import { type AppRouter, createCaller } from "~/server/api/root";
import { flushAfterResponse } from "~/server/observability/sdk/flush";
import { redirectOnUnauthorized } from "./auth-errors";
import { createQueryClient } from "./query-client";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
	// Server-component tRPC calls are traced too, so drain after the render.
	// Cached once per request, so this schedules one drain.
	flushAfterResponse();

	const heads = new Headers(await headers());
	heads.set("x-trpc-source", "rsc");

	return createTRPCContext({
		headers: heads,
	});
});

const getQueryClient = cache(createQueryClient);
// A stale cookie passes proxy; send its UNAUTHORIZED to /sign-in, which
// AsyncBoundary passes through instead of showing an error card (adr026).
const caller = createCaller(createContext, {
	onError: redirectOnUnauthorized,
});

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
	caller,
	getQueryClient,
);
