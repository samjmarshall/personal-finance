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

/** Only failures a retry can fix: network drop, 5xx, failed server prefetch. 4xx and redirects fail fast. */
export function isTransientError(error: unknown): boolean {
	if (!(error instanceof TRPCClientError)) {
		// A failed server prefetch arrives as a plain error with no status. Retry
		// it with a real fetch, which tells 4xx from 5xx. Never retry a redirect.
		const digest = (error as { digest?: unknown } | null)?.digest;
		return !(typeof digest === "string" && digest.startsWith("NEXT_"));
	}
	// A network failure never got a response, so it carries no data.
	const status = (error.data as { httpStatus?: number } | undefined)
		?.httpStatus;
	return status === undefined || status >= 500;
}

export const createQueryClient = () =>
	new QueryClient({
		// Toast every mutation failure but a stale session, which redirects (ADR001:
		// a global transport client is allowed). Client-only: no server mutations.
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
				// Default 3 retries (1s/2s/4s) hold the error card ~7s, again on each
				// Try again. 2 quick retries (0.3s, 0.9s) cover a blip. Server never retries.
				retry: (failureCount, error) =>
					!environmentManager.isServer() &&
					failureCount < 2 &&
					isTransientError(error),
				retryDelay: (attempt) => 300 * 3 ** attempt,
			},
			dehydrate: {
				serializeData: SuperJSON.serialize,
				// Default redaction drops the redirect marker that sends a stale session
				// to sign-in. React still strips error messages in production.
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
