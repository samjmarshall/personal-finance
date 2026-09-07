// Depth cap: a cause chain this long is a cycle or a bug, not a driver error.
const MAX_CAUSE_DEPTH = 10;

/**
 * True when `error`, or anything in its `cause` chain, is a driver error carrying
 * this SQLSTATE (e.g. 23503 = foreign_key_violation, 23505 = unique_violation).
 *
 * The chain walk is load-bearing: drizzle wraps every driver error in a
 * `DrizzleQueryError` ("Failed query: …") and hangs the postgres.js error off
 * `cause`, so a top-level-only check never matches and conflicts surface as 500s.
 */
export function isPgError(error: unknown, code: string): boolean {
	let current = error;
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
		if (typeof current !== "object" || current === null) return false;
		if ("code" in current && (current as { code: unknown }).code === code)
			return true;
		const { cause } = current as { cause?: unknown };
		if (cause === undefined || cause === current) return false;
		current = cause;
	}
	return false;
}
