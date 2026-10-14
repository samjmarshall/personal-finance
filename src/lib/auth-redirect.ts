const AUTH_PAGES = new Set(["/sign-in", "/sign-up"]);

/**
 * Proxy's optimistic gate (adr026): cookie presence only, never validity.
 * Never redirects the auth pages, so an expired cookie can't loop.
 */
export function authRedirect(
	pathname: string,
	hasCookie: boolean,
): string | null {
	if (hasCookie || AUTH_PAGES.has(pathname)) return null;
	return "/sign-in";
}
