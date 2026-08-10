import { IncomeView } from "~/app/_components/income/income-view";
import { api, HydrateClient } from "~/trpc/server";

export default async function IncomePage() {
	void api.income.list.prefetch();
	return (
		<HydrateClient>
			<IncomeView />
		</HydrateClient>
	);
}
