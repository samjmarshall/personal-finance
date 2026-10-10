import { redirect } from "next/navigation";

import { receiptUploadPrefix } from "~/domain/receipts";
import { env } from "~/env";
import { getSession } from "~/server/auth/server";
import { api, HydrateClient } from "~/trpc/server";
import { ReceiptsView } from "./_components/receipts-view";

export default async function ReceiptsPage() {
	// Proxy only checks a cookie is there, so check the session before the env
	// value reaches the response (adr026).
	if (!(await getSession())) redirect("/sign-in");
	void api.receipt.list.prefetch();
	return (
		<HydrateClient>
			<ReceiptsView uploadPrefix={receiptUploadPrefix(env.BLOB_PATH_PREFIX)} />
		</HydrateClient>
	);
}
