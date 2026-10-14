import { io } from "next/cache";

import { AsyncBoundary } from "~/components/async-boundary";
import { IncomeSkeleton } from "~/components/route-skeletons";
import { api, HydrateClient } from "~/trpc/server";
import { IncomeView } from "./_components/income-view";

export default function IncomePage() {
	return (
		<AsyncBoundary fade={false} label="income" skeleton={<IncomeSkeleton />}>
			<IncomeData />
		</AsyncBoundary>
	);
}

async function IncomeData() {
	// Prefetch and dehydrate read Date.now() before tRPC reaches headers(), a
	// sync-IO prerender error. io() ends the static shell here first.
	await io();
	void api.income.list.prefetch();
	return (
		<HydrateClient>
			<IncomeView />
		</HydrateClient>
	);
}
