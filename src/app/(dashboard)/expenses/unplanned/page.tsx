import { api, HydrateClient } from "~/trpc/server";
import { UnplannedView } from "./_components/unplanned-view";

export default async function UnplannedPage() {
	void api.expense.list.prefetch();
	void api.category.list.prefetch();
	void api.setting.fortnightAnchor.prefetch();
	// transaction.unplanned isn't prefetched: its window input is computed
	// client-side from the anchor + today, so the server can't match the key.
	return (
		<HydrateClient>
			<UnplannedView />
		</HydrateClient>
	);
}
