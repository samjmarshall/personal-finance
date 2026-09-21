import "server-only";

import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { headers } from "next/headers";
import { after } from "next/server";
import { cache } from "react";

import { type AppRouter, createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { flushTelemetry } from "~/server/observability/flush";
import { createQueryClient } from "./query-client";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
	// Server-component tRPC calls run the tracing middleware too, so drain the
	// sinks after the render, before the serverless freeze — the HTTP route does
	// the same. cache() runs this once per request, so it schedules one drain.
	after(flushTelemetry);

	const heads = new Headers(await headers());
	heads.set("x-trpc-source", "rsc");

	return createTRPCContext({
		headers: heads,
	});
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
	caller,
	getQueryClient,
);
