// Not the barrel: it carries the bank's zod schemas, and this runs in the browser.
import { accountLabel } from "~/domain/cdr/account-label";
import type { CdrSyncState } from "~/domain/cdr/cdr.interface";
import { isDeadConsent, isSyncingConsent } from "~/domain/cdr/consent";
import { CdrConnectionStatus } from "~/lib/constants";
import { formatDate } from "~/lib/utils";

export interface ConnectionNotice {
	/** Accounts behind for a cause only the logs hold; no member fix. */
	behind: string | null;
	/** Fixed by a reauthorize in RedBark's dashboard, so the link sits right after it. */
	reauthorize: string | null;
	title: string;
	tone: "alert" | "warn";
}

const list = new Intl.ListFormat("en-AU", { type: "conjunction" });

type Label = (a: CdrSyncState) => string;

// A household often holds several of one product ("Everyday Offset" ×3), so a
// shared name gets its masked number.
function labeller(states: CdrSyncState[]): Label {
	const counts = new Map<string, number>();
	for (const s of states) {
		const name = accountLabel(s);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return (a) => {
		const name = accountLabel(a);
		return (counts.get(name) ?? 0) > 1 && a.accountNumber
			? `${name} (${a.accountNumber})`
			: name;
	};
}

const names = (accounts: CdrSyncState[], label: Label) =>
	list.format(accounts.map(label));

const behindLine = (a: CdrSyncState, label: Label) =>
	a.lastSyncedAt
		? `${label(a)} hasn't synced since ${formatDate(a.lastSyncedAt)}.`
		: `${label(a)} hasn't synced yet.`;

// The cron runs daily, so two days allows one missed run before warning.
const STALLED_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// A run that dies before any account (dead key, discovery error, cron off) saves
// no error, so the only sign is that no live account moved.
function stalledLine(states: CdrSyncState[]): string | null {
	const live = states.filter((s) => isSyncingConsent(s.connectionStatus));
	if (live.length === 0) return null;
	const newest = Math.max(
		...live.map((s) => (s.lastSyncedAt ?? s.createdAt).getTime()),
	);
	if (Date.now() - newest <= STALLED_AFTER_MS) return null;
	return live.some((s) => s.lastSyncedAt)
		? `No bank account has synced since ${formatDate(new Date(newest))}.`
		: "No bank account has synced yet.";
}

// Never shows error text; logs hold the cause. A dead consent sets tone and title
// so softer notices can't bury it; other banks' warnings still show.
export function connectionNotice(
	states: CdrSyncState[],
): ConnectionNotice | null {
	const dead = states.filter((s) => isDeadConsent(s.connectionStatus));
	const expiring = states.filter(
		(s) => s.connectionStatus === CdrConnectionStatus.Expiring,
	);
	// A dead account's old error is already covered by "syncing has stopped".
	const stuck = states.filter(
		(s) => s.lastError !== null && !isDeadConsent(s.connectionStatus),
	);
	const stalled = stalledLine(states);
	const label = labeller(states);

	const reauthorizeLines = [
		...(dead.length > 0
			? [
					`Syncing has stopped for ${names(dead, label)}. Reauthorize in RedBark's dashboard and it picks up where it left off.`,
				]
			: []),
		...(expiring.length > 0
			? [
					`${names(expiring, label)} will lose access soon. Reauthorize in RedBark's dashboard to keep syncing.`,
				]
			: []),
	];
	const behindLines = [
		...(stalled ? [stalled] : []),
		...stuck.map((a) => behindLine(a, label)),
	];
	if (reauthorizeLines.length === 0 && behindLines.length === 0) return null;

	// Title leads with the most urgent issue. Plural counts banks, not accounts:
	// one bank's accounts share one connection.
	const s = (accounts: CdrSyncState[]) =>
		new Set(accounts.map((a) => a.connectionId)).size > 1 ? "s" : "";
	const title =
		dead.length > 0
			? `Reauthorize your bank connection${s([...dead, ...expiring])}`
			: expiring.length > 0
				? `Bank connection${s(expiring)} expiring`
				: "Bank sync is behind";
	return {
		behind: behindLines.length > 0 ? behindLines.join(" ") : null,
		reauthorize:
			reauthorizeLines.length > 0 ? reauthorizeLines.join(" ") : null,
		title,
		tone: dead.length > 0 ? "alert" : "warn",
	};
}
