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

// Prefetches live here, not in the page: they read headers(), so they must
// run inside the boundary.
async function ExpensesData() {
	void api.expense.list.prefetch();
	void api.expense.consumption.prefetch();
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
