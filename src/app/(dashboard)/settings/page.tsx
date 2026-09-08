import { SettingsView } from "~/app/_components/settings/settings-view";
import { env } from "~/env";
import { api, HydrateClient } from "~/trpc/server";

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
