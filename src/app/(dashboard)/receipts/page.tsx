import { api, HydrateClient } from "~/trpc/server";
import { ReceiptsView } from "./_components/receipts-view";

export default async function ReceiptsPage() {
	void api.receipt.list.prefetch();
	return (
		<HydrateClient>
			<ReceiptsView />
		</HydrateClient>
	);
}
