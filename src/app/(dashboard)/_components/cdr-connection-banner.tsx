import { api } from "~/trpc/server";
import { connectionNotice } from "./cdr-connection.display";
import { CdrConnectionNotice } from "./cdr-connection-notice";

export async function CdrConnectionBanner() {
	const notice = connectionNotice(await api.cdr.syncState());
	return notice ? <CdrConnectionNotice notice={notice} /> : null;
}
