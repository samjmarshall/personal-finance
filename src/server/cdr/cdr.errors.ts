/**
 * A whole `cdr-sync` run's failure, as plain data: the controller turns it into
 * Inngest's retry signal, so the service never imports `inngest`.
 */
export class CdrSyncError extends Error {
	/** False when retrying would fail the same way (a mapping throw, a 4xx). */
	readonly retryable: boolean;
	/** Longest wait RedBark asked for; null when none gave one. */
	readonly retryAfterMs: number | null;

	constructor(
		message: string,
		{
			retryable,
			retryAfterMs = null,
			cause,
		}: { retryable: boolean; retryAfterMs?: number | null; cause?: unknown },
	) {
		super(message, { cause });
		this.name = "CdrSyncError";
		this.retryable = retryable;
		this.retryAfterMs = retryAfterMs;
	}
}
