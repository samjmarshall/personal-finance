import { api, HydrateClient } from "~/trpc/server";
import { TransactionsView } from "./_components/transactions-view";

export default async function TransactionsPage() {
	void api.category.list.prefetch();
	void api.expense.list.prefetch();
	void api.transaction.list.prefetch({
		sortBy: "date",
		sortDir: "desc",
		limit: 50,
		offset: 0,
	});
	return (
		<HydrateClient>
			<TransactionsView />
		</HydrateClient>
	);
}
