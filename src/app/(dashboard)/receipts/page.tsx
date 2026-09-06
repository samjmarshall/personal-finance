import { ReceiptsView } from "~/app/_components/receipts/receipts-view";
import { api, HydrateClient } from "~/trpc/server";

export default async function ReceiptsPage() {
	void api.receipt.list.prefetch();
	return (
		<HydrateClient>
			<ReceiptsView />
		</HydrateClient>
	);
}
