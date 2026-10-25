import { accountLabel, type CdrSyncState, isDeadConsent } from "~/domain/cdr";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";

export interface ConnectionNotice {
	detail: string;
	/** The fix is a reauthorize in RedBark's dashboard, so the banner links there. */
	inRedBark: boolean;
	title: string;
	tone: "alert" | "warn";
}

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });

const names = (accounts: CdrSyncState[]) =>
	list.format(accounts.map(accountLabel));

const behindLine = (a: CdrSyncState) =>
	a.lastSyncedAt
		? `${accountLabel(a)} hasn't synced since ${formatDate(a.lastSyncedAt)}.`
		: `${accountLabel(a)} hasn't synced yet.`;

// Never shows the error text: logs hold the cause, banner only says which account is behind.
// Alert wins over warn so a dead consent is never buried under a softer notice.
export function connectionNotice(
	states: CdrSyncState[],
): ConnectionNotice | null {
	const dead = states.filter((s) => isDeadConsent(s.connectionStatus));
	if (dead.length > 0) {
		return {
			detail: `Syncing has stopped for ${names(dead)}. Reauthorize in RedBark's dashboard and it picks up where it left off.`,
			inRedBark: true,
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
					`${names(expiring)} will lose access soon. Reauthorize in RedBark's dashboard to keep syncing.`,
				]
			: []),
		...stuck.map(behindLine),
	];
	return {
		detail: lines.join(" "),
		inRedBark: expiring.length > 0,
		title:
			stuck.length > 0 ? "Bank sync is behind" : "Bank connection expiring",
		tone: "warn",
	};
}
