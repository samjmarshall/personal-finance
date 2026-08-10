import { ExpensesView } from "~/app/_components/expenses/expenses-view";
import { api, HydrateClient } from "~/trpc/server";

export default async function ExpensesPage() {
	void api.expense.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
