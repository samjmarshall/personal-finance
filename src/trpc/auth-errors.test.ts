import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { redirect } from "next/navigation";
import { describe, expect, it } from "vitest";
import {
	isAuthError,
	redirectOnUnauthorized,
	rethrowAuthFailure,
} from "~/trpc/auth-errors";

function thrownBy(fn: () => void): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

describe("redirectOnUnauthorized", () => {
	it("throws a redirect to /sign-in for UNAUTHORIZED", () => {
		const error = thrownBy(() =>
			redirectOnUnauthorized({
				error: new TRPCError({ code: "UNAUTHORIZED" }),
			}),
		);
		expect(error).toMatchObject({
			digest: expect.stringMatching(/^NEXT_REDIRECT;\w+;\/sign-in;/),
		});
	});

	it("leaves other codes to the caller's own rethrow", () => {
		expect(() =>
			redirectOnUnauthorized({
				error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
			}),
		).not.toThrow();
	});
});

describe("isAuthError", () => {
	it("recognises a client UNAUTHORIZED", () => {
		const error = TRPCClientError.from({
			error: {
				code: -32001,
				message: "UNAUTHORIZED",
				data: { code: "UNAUTHORIZED" },
			},
		});
		expect(isAuthError(error)).toBe(true);
	});

	it("recognises a streamed redirect", () => {
		const error = thrownBy(() =>
			redirectOnUnauthorized({
				error: new TRPCError({ code: "UNAUTHORIZED" }),
			}),
		);
		expect(isAuthError(error)).toBe(true);
	});

	it("rejects other errors", () => {
		const forbidden = TRPCClientError.from({
			error: {
				code: -32003,
				message: "FORBIDDEN",
				data: { code: "FORBIDDEN" },
			},
		});
		expect(isAuthError(forbidden)).toBe(false);
		expect(isAuthError(new Error("boom"))).toBe(false);
		expect(isAuthError(thrownBy(() => redirect("/expenses")))).toBe(false);
	});
});

describe("rethrowAuthFailure", () => {
	async function clientAfterPrefetches(...outcomes: Promise<unknown>[]) {
		const queryClient = new QueryClient();
		await Promise.all(
			outcomes.map((outcome, i) =>
				queryClient.prefetchQuery({
					queryKey: ["q", i],
					queryFn: () => outcome,
					retry: false,
				}),
			),
		);
		return queryClient;
	}

	it("throws the sign-in redirect a prefetch already failed with", async () => {
		const signIn = thrownBy(() =>
			redirectOnUnauthorized({
				error: new TRPCError({ code: "UNAUTHORIZED" }),
			}),
		);
		const queryClient = await clientAfterPrefetches(
			Promise.resolve("ok"),
			Promise.reject(signIn),
		);

		expect(thrownBy(() => rethrowAuthFailure(queryClient))).toBe(signIn);
	});

	// Those keep their own path: dehydrated, then the card or a client retry.
	it("leaves other failures and pending prefetches alone", async () => {
		const queryClient = await clientAfterPrefetches(
			Promise.reject(new Error("boom")),
		);
		void queryClient.prefetchQuery({
			queryKey: ["pending"],
			queryFn: () => new Promise(() => {}),
		});

		expect(() => rethrowAuthFailure(queryClient)).not.toThrow();
	});
});
