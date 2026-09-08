import { SettingsView } from "~/app/_components/settings/settings-view";
import { api, HydrateClient } from "~/trpc/server";

export default async function SettingsPage() {
	void api.setting.fortnightAnchor.prefetch();
	void api.allowedSender.list.prefetch();
	return (
		<HydrateClient>
			<SettingsView />
		</HydrateClient>
	);
}
