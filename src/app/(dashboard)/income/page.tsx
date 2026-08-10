import { HydrateClient, api } from "~/trpc/server";
import { IncomeView } from "~/app/_components/income/income-view";

export default async function IncomePage() {
	void api.income.list.prefetch();
	return (
		<HydrateClient>
			<IncomeView />
		</HydrateClient>
	);
}
