import { io } from "next/cache";

import { AsyncBoundary } from "~/components/async-boundary";
import { ExpensesSkeleton } from "~/components/route-skeletons";
import { api, HydrateClient } from "~/trpc/server";
import { ExpensesView } from "./_components/expenses-view";

export default function ExpensesPage() {
	return (
		<AsyncBoundary
			fade={false}
			label="expenses"
			skeleton={<ExpensesSkeleton />}
		>
			<ExpensesData />
		</AsyncBoundary>
	);
}

// Prefetch here, not in the page: it reads request headers, so it must run
// inside the boundary.
async function ExpensesData() {
	// Prefetch and dehydrate read Date.now() before tRPC reaches headers(), a
	// sync-IO prerender error. io() ends the static shell here first.
	await io();
	void api.expense.list.prefetch();
	void api.expense.consumption.prefetch();
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
