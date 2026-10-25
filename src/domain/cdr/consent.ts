import { CdrConnectionStatus } from "~/lib/constants";

const DEAD: ReadonlySet<CdrConnectionStatus> = new Set([
	CdrConnectionStatus.Expired,
	CdrConnectionStatus.Invalidated,
	CdrConnectionStatus.Revoked,
]);

/** Consent is gone: the sync skips the account and the banner says syncing has stopped. */
export function isDeadConsent(status: CdrConnectionStatus): boolean {
	return DEAD.has(status);
}
