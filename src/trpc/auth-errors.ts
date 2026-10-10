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

/** A stale session, from a client fetch or a server redirect streamed in a prefetch. */
export function isAuthError(error: unknown): boolean {
	if (error instanceof TRPCClientError) {
		return error.data?.code === "UNAUTHORIZED";
	}
	const digest = (error as { digest?: unknown } | null)?.digest;
	return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
