import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { authRedirect } from "~/lib/auth-redirect";

export function proxy(request: NextRequest) {
	const to = authRedirect(
		request.nextUrl.pathname,
		getSessionCookie(request) !== null,
	);
	if (to) return NextResponse.redirect(new URL(to, request.url));
	return NextResponse.next();
}

export const config = {
	// API routes authenticate themselves (tRPC returns UNAUTHORIZED); a redirect
	// would hand fetch callers an HTML page instead.
	matcher: "/((?!api|sign-in|sign-up|_next/static|_next/image|.*\\..*).*)",
};
