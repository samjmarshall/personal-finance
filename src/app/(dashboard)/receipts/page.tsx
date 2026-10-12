import { redirect } from "next/navigation";

import { AsyncBoundary } from "~/components/async-boundary";
import { ReceiptsSkeleton } from "~/components/route-skeletons";
import { receiptUploadPrefix } from "~/domain/receipts";
import { env } from "~/env";
import { getSession } from "~/server/auth/server";
import { api, HydrateClient } from "~/trpc/server";
import { DEFAULT_FILTERS, toListInput } from "./_components/receipt-list-input";
import { ReceiptsView } from "./_components/receipts-view";

export default function ReceiptsPage() {
	return (
		<AsyncBoundary
			fade={false}
			label="receipts"
			skeleton={<ReceiptsSkeleton />}
		>
			<ReceiptsData />
		</AsyncBoundary>
	);
}

async function ReceiptsData() {
	// Proxy only checks a cookie is there, so check the session before the env
	// value reaches the response (adr026).
	if (!(await getSession())) redirect("/sign-in");
	void api.receipt.list.prefetch(toListInput(DEFAULT_FILTERS));
	return (
		<HydrateClient>
			<ReceiptsView uploadPrefix={receiptUploadPrefix(env.BLOB_PATH_PREFIX)} />
		</HydrateClient>
	);
}
