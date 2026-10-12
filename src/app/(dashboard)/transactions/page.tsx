import { AsyncBoundary } from "~/components/async-boundary";
import { TransactionsSkeleton } from "~/components/route-skeletons";
import { api, HydrateClient } from "~/trpc/server";
import {
	DEFAULT_FILTERS,
	toListInput,
} from "./_components/transaction-list-input";
import { TransactionsView } from "./_components/transactions-view";

export default function TransactionsPage() {
	return (
		<AsyncBoundary
			fade={false}
			label="transactions"
			skeleton={<TransactionsSkeleton />}
		>
			<TransactionsData />
		</AsyncBoundary>
	);
}

// Prefetch here, not in the page: it reads request headers, so it must run
// inside the boundary.
async function TransactionsData() {
	void api.category.list.prefetch();
	void api.expense.list.prefetch();
	void api.transaction.list.prefetch(toListInput(DEFAULT_FILTERS));
	return (
		<HydrateClient>
			<TransactionsView />
		</HydrateClient>
	);
}
