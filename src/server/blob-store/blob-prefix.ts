// No imports: src/env.ts and scripts/blob-prefix-delete.ts load this file
// outside the app's module resolution.

/** `local/<branch>/` or `preview/<branch>/` — the Neon branch names, plus a trailing slash. */
const BRANCH_PREFIX = /^(local|preview)\/.+\/$/;

export function isBranchPrefix(prefix: string): boolean {
	return BRANCH_PREFIX.test(prefix);
}

/**
 * Whether the environment behind `prefix` made `pathname`. Production (`""`) owns
 * everything outside the branch prefixes.
 */
export function owns(prefix: string, pathname: string): boolean {
	if (prefix !== "") return pathname.startsWith(prefix);
	return !pathname.startsWith("local/") && !pathname.startsWith("preview/");
}
