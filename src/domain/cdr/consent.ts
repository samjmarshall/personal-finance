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

/** Consent is gone: the sync skips the account and the banner says syncing has stopped. */
export function isDeadConsent(status: CdrConnectionStatus): boolean {
	return DEAD.has(status);
}

/** The sync pulls this account, so the banner's stall check watches it. */
export function isSyncingConsent(status: CdrConnectionStatus): boolean {
	return SYNCING.has(status);
}
