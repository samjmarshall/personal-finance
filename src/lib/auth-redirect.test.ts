import { describe, expect, it } from "vitest";
import { authRedirect } from "~/lib/auth-redirect";

describe("authRedirect", () => {
	it.each(["/", "/expenses"])(
		"sends %s to /sign-in without a cookie",
		(path) => {
			expect(authRedirect(path, false)).toBe("/sign-in");
		},
	);

	it("lets a request with a cookie through", () => {
		expect(authRedirect("/expenses", true)).toBeNull();
	});

	// A signed-in redirect off the auth pages would loop on an expired cookie.
	it.each(["/sign-in", "/sign-up"])(
		"never redirects %s, with or without a cookie",
		(path) => {
			expect(authRedirect(path, false)).toBeNull();
			expect(authRedirect(path, true)).toBeNull();
		},
	);
});
