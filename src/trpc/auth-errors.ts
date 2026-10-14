import type { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import type { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";

/**
 * RSC caller `onError`. Must throw synchronously: tRPC doesn't await it, and
 * rethrows whatever it throws in place of the original error.
 */
export function redirectOnUnauthorized({ error }: { error: TRPCError }) {
	if (error.code === "UNAUTHORIZED") redirect("/sign-in");
}

/** A stale session: a client UNAUTHORIZED, or the sign-in redirect streamed in a prefetch. */
export function isAuthError(error: unknown): boolean {
	if (error instanceof TRPCClientError) {
		return error.data?.code === "UNAUTHORIZED";
	}
	const digest = (error as { digest?: unknown } | null)?.digest;
	return (
		typeof digest === "string" && /^NEXT_REDIRECT;\w+;\/sign-in;/.test(digest)
	);
}

/**
 * Throws the sign-in redirect a prefetch already failed with. Dehydrate drops a
 * failed query, so SSR would refetch it with no cookie and log UNAUTHORIZED.
 */
export function rethrowAuthFailure(queryClient: QueryClient) {
	for (const query of queryClient.getQueryCache().getAll()) {
		if (isAuthError(query.state.error)) throw query.state.error;
	}
}
