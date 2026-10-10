import { redirect } from "next/navigation";

import { getSession } from "~/server/auth/server";

/**
 * Sends a signed-in Member from the auth pages to `/`. A real session check,
 * not cookie presence: proxy redirecting on the cookie would loop on an
 * expired one (adr026).
 */
export async function RedirectIfSignedIn() {
	if (await getSession()) redirect("/");
	return null;
}
