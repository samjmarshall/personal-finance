import { io } from "next/cache";

import { AsyncBoundary } from "~/components/async-boundary";
import { ImportSkeleton } from "~/components/route-skeletons";
import { api, HydrateClient } from "~/trpc/server";
import { ImportView } from "./_components/import-view";

export default function ImportPage() {
	return (
		<AsyncBoundary
			fade={false}
			label="bank import"
			skeleton={<ImportSkeleton />}
		>
			<ImportData />
		</AsyncBoundary>
	);
}

// Prefetch here, not in the page: it reads request headers, so it must run
// inside the boundary.
async function ImportData() {
	// Prefetch and dehydrate read Date.now() before tRPC reaches headers(), a
	// sync-IO prerender error. io() ends the static shell here first.
	await io();
	void api.cdr.latestImport.prefetch();
	void api.transaction.possibleDuplicates.prefetch();
	return (
		<HydrateClient>
			<ImportView />
		</HydrateClient>
	);
}
