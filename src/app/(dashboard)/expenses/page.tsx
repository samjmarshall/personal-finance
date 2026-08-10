import { HydrateClient, api } from "~/trpc/server";
import { ExpensesView } from "~/app/_components/expenses/expenses-view";

export default async function ExpensesPage() {
	void api.expense.list.prefetch();
	return (
		<HydrateClient>
			<ExpensesView />
		</HydrateClient>
	);
}
