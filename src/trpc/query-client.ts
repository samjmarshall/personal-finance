import {
	defaultShouldDehydrateQuery,
	environmentManager,
	MutationCache,
	QueryCache,
	QueryClient,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";
import SuperJSON from "superjson";

import { isAuthError } from "./auth-errors";

// A server-side Zod failure arrives with its raw issues array as `message`; pull
// the first field/form message so the toast reads plainly instead of showing
// JSON. Anything else keeps its own message.
function toToastMessage(error: unknown): string {
	if (error instanceof TRPCClientError) {
		const zodError = (
			error.data as {
				zodError?: {
					formErrors: string[];
					fieldErrors: Record<string, string[]>;
				} | null;
			} | null
		)?.zodError;
		const first =
			zodError?.formErrors[0] ??
			Object.values(zodError?.fieldErrors ?? {}).flat()[0];
		if (first) return first;
	}
	return error instanceof Error ? error.message : "Something went wrong.";
}

// Client fetches skip the RSC caller's redirect, and a plain query holds a
// streamed one without throwing, so a stale session goes to /sign-in here (adr026).
function redirectIfUnauthorized(error: unknown): boolean {
	if (environmentManager.isServer() || !isAuthError(error)) return false;
	window.location.assign("/sign-in");
	return true;
}

export const createQueryClient = () =>
	new QueryClient({
		// Surface every mutation failure but UNAUTHORIZED as a toast (ADR001: the
		// QueryClient is a permitted global transport client). Fires client-side
		// only — mutations never run through the server prefetch client.
		mutationCache: new MutationCache({
			onError: (error) => {
				if (!redirectIfUnauthorized(error)) {
					toast.error(toToastMessage(error));
				}
			},
		}),
		queryCache: new QueryCache({ onError: redirectIfUnauthorized }),
		defaultOptions: {
			queries: {
				// With SSR, we usually want to set some default staleTime
				// above 0 to avoid refetching immediately on the client
				staleTime: 30 * 1000,
				// Keeps TanStack's server default of 0. An auth error won't heal on
				// retry, and 3 backed-off retries hold the redirect for ~7s.
				retry: (failureCount, error) =>
					!environmentManager.isServer() &&
					failureCount < 3 &&
					!isAuthError(error),
			},
			dehydrate: {
				serializeData: SuperJSON.serialize,
				// The default redacts a rejected pending prefetch to Error("redacted"),
				// dropping the NEXT_REDIRECT digest that sends a stale session to
				// /sign-in. Flight still strips messages in production.
				shouldRedactErrors: () => false,
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
			hydrate: {
				deserializeData: SuperJSON.deserialize,
			},
		},
	});
