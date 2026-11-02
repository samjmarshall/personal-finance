import { CdrConnectionStatus } from "~/lib/constants";

const DEAD: ReadonlySet<CdrConnectionStatus> = new Set([
	CdrConnectionStatus.Expired,
	CdrConnectionStatus.Invalidated,
	CdrConnectionStatus.Revoked,
]);

const SYNCING: ReadonlySet<CdrConnectionStatus> = new Set([
	CdrConnectionStatus.Active,
	CdrConnectionStatus.Expiring,
]);

/** Consent is gone; the sync skips these accounts. */
export function isDeadConsent(status: CdrConnectionStatus): boolean {
	return DEAD.has(status);
}

/** Consent still works; the sync pulls these accounts. */
export function isSyncingConsent(status: CdrConnectionStatus): boolean {
	return SYNCING.has(status);
}
