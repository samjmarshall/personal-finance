import { createAuthClient } from "better-auth/react";
import { newTraceparent } from "~/lib/traceparent";

// Structural match for better-auth's FetchEsque (@better-fetch/fetch is a
// transitive dep, not directly importable).
type FetchImpl = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

// Fresh traceparent per better-auth fetch so the server span parents onto the
// client trace (adr018). Clones headers — never mutates the caller's init.
export function withTraceparent(inner: FetchImpl): FetchImpl {
	return (input, init) => {
		// Headers can ride on init or on a Request input; init wins per fetch spec.
		// Miss the Request case and its cookie/content-type get dropped.
		const source =
			init?.headers ?? (input instanceof Request ? input.headers : undefined);
		const headers = new Headers(source);
		headers.set("traceparent", newTraceparent());
		return inner(input, { ...init, headers });
	};
}

export const authClient = createAuthClient({
	fetchOptions: {
		customFetchImpl: withTraceparent((input, init) => fetch(input, init)),
	},
});

export type Session = typeof authClient.$Infer.Session;
