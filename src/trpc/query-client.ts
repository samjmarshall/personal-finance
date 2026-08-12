import {
	defaultShouldDehydrateQuery,
	MutationCache,
	QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import SuperJSON from "superjson";

export const createQueryClient = () =>
	new QueryClient({
		// Surface every mutation failure as a toast (ADR001: the QueryClient is a
		// permitted global transport client). Fires client-side only — mutations
		// never run through the server prefetch client.
		mutationCache: new MutationCache({
			onError: (error) => toast.error(error.message),
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
