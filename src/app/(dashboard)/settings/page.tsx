import { redirect } from "next/navigation";

import { env } from "~/env";
import { getSession } from "~/server/auth/server";
import { api, HydrateClient } from "~/trpc/server";
import { SettingsView } from "./_components/settings-view";

export default async function SettingsPage() {
	// Proxy only checks a cookie is there, so check the session before the env
	// value reaches the response (adr026).
	if (!(await getSession())) redirect("/sign-in");
	void api.setting.fortnightAnchor.prefetch();
	void api.allowedSender.list.prefetch();
	return (
		<HydrateClient>
			{/* Read here, not in the view: the address is a server-only env value and
			    SettingsView is a client component. */}
			<SettingsView inboundAddress={env.RESEND_INBOUND_ADDRESS} />
		</HydrateClient>
	);
}
