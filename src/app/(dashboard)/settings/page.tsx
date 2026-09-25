import { env } from "~/env";
import { api, HydrateClient } from "~/trpc/server";
import { SettingsView } from "./_components/settings-view";

export default async function SettingsPage() {
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
