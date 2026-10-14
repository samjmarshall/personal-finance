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
	void api.expense.list.prefetch();
	void api.expense.consumption.prefetch();
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
