import { HydrateClient, api } from "~/trpc/server";
import { TransactionsView } from "~/app/_components/transactions/transactions-view";

export default async function TransactionsPage() {
	void api.transaction.categories.prefetch();
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
