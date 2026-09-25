import { api, HydrateClient } from "~/trpc/server";
import { ExpensesView } from "./_components/expenses-view";

export default async function ExpensesPage() {
	void api.expense.list.prefetch();
	void api.expense.consumption.prefetch();
	void api.category.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
