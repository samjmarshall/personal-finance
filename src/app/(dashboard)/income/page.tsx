import { api, HydrateClient } from "~/trpc/server";
import { IncomeView } from "./_components/income-view";

export default async function IncomePage() {
	void api.income.list.prefetch();
	return (
		<HydrateClient>
			<IncomeView />
		</HydrateClient>
	);
}
