import { receiptUploadPrefix } from "~/domain/receipts";
import { env } from "~/env";
import { api, HydrateClient } from "~/trpc/server";
import { ReceiptsView } from "./_components/receipts-view";

export default async function ReceiptsPage() {
	void api.receipt.list.prefetch();
	return (
		<HydrateClient>
			<ReceiptsView uploadPrefix={receiptUploadPrefix(env.BLOB_PATH_PREFIX)} />
		</HydrateClient>
	);
}
