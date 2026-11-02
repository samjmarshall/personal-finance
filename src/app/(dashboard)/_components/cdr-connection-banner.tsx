import { io } from "next/cache";

import { api } from "~/trpc/server";
import { ClientConnectionNotice } from "./cdr-connection-notice";

export async function CdrConnectionBanner() {
	// The tRPC caller reads Date.now() before it reaches headers(), a sync-IO
	// prerender error. io() ends the static shell here first.
	await io();
	return <ClientConnectionNotice states={await api.cdr.syncState()} />;
}
