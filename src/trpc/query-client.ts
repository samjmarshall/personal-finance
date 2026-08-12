import {
	defaultShouldDehydrateQuery,
	MutationCache,
	QueryClient,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";
import SuperJSON from "superjson";

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

export const createQueryClient = () =>
	new QueryClient({
		// Surface every mutation failure as a toast (ADR001: the QueryClient is a
		// permitted global transport client). Fires client-side only — mutations
		// never run through the server prefetch client.
		mutationCache: new MutationCache({
			onError: (error) => toast.error(toToastMessage(error)),
		}),
		defaultOptions: {
			queries: {
				// With SSR, we usually want to set some default staleTime
				// above 0 to avoid refetching immediately on the client
				staleTime: 30 * 1000,
			},
			dehydrate: {
				serializeData: SuperJSON.serialize,
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
			hydrate: {
				deserializeData: SuperJSON.deserialize,
			},
		},
	});
