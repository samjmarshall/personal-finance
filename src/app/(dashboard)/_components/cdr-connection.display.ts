import type { CdrSyncState } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";

export interface ConnectionNotice {
	detail: string;
	title: string;
	tone: "alert" | "warn";
}

const DEAD: ReadonlySet<CdrConnectionStatus> = new Set([
	CdrConnectionStatus.Expired,
	CdrConnectionStatus.Invalidated,
	CdrConnectionStatus.Revoked,
]);

const accountLabel = (a: CdrSyncState) =>
	a.nickname ?? a.accountName ?? a.accountId;

const names = (accounts: CdrSyncState[]) =>
	accounts.map(accountLabel).join(", ");

const lastSync = (a: CdrSyncState) =>
	a.lastSyncedAt
		? `${accountLabel(a)} hasn't synced since ${formatDate(a.lastSyncedAt)}.`
		: `${accountLabel(a)} hasn't synced yet.`;

// Never carries `lastError`: the logs hold the cause, the banner only says who is stale.
// Alert wins over warn so a dead consent is never buried under a softer notice.
export function connectionNotice(
	states: CdrSyncState[],
): ConnectionNotice | null {
	const dead = states.filter((s) => DEAD.has(s.connectionStatus));
	if (dead.length > 0) {
		return {
			detail: `Syncing has stopped for ${names(dead)}. Reauthorize the connection in RedBark's dashboard; it keeps its accounts and picks up where it left off.`,
			title: "Reauthorize your bank connection",
			tone: "alert",
		};
	}

	const expiring = states.filter(
		(s) => s.connectionStatus === CdrConnectionStatus.Expiring,
	);
	const stuck = states.filter((s) => s.lastError !== null);
	if (expiring.length === 0 && stuck.length === 0) return null;

	const lines = [
		...(expiring.length > 0
			? [
					`${names(expiring)} will lose access soon. Reauthorize it in RedBark's dashboard.`,
				]
			: []),
		...stuck.map(lastSync),
	];
	return {
		detail: lines.join(" "),
		title:
			stuck.length > 0 ? "Bank sync is behind" : "Bank connection expiring",
		tone: "warn",
	};
}
