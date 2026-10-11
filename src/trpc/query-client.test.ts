import { TRPCClientError } from "@trpc/client";
import { redirect } from "next/navigation";
import { describe, expect, it } from "vitest";
import { isTransientError } from "~/trpc/query-client";

function trpcError(code: string, httpStatus: number) {
	return TRPCClientError.from({
		error: { code: -32000, message: code, data: { code, httpStatus } },
	});
}

function thrownBy(fn: () => void): unknown {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return undefined;
}

describe("isTransientError", () => {
	it("retries a server fault", () => {
		expect(isTransientError(trpcError("INTERNAL_SERVER_ERROR", 500))).toBe(
			true,
		);
	});

	it("retries a network failure, which carries no response data", () => {
		expect(
			isTransientError(TRPCClientError.from(new Error("fetch failed"))),
		).toBe(true);
	});

	it("fails fast on a client error, including a stale session", () => {
		expect(isTransientError(trpcError("BAD_REQUEST", 400))).toBe(false);
		expect(isTransientError(trpcError("UNAUTHORIZED", 401))).toBe(false);
		expect(isTransientError(trpcError("NOT_FOUND", 404))).toBe(false);
	});

	it("fails fast on anything that isn't a tRPC error", () => {
		expect(isTransientError(new Error("boom"))).toBe(false);
		expect(isTransientError(thrownBy(() => redirect("/sign-in")))).toBe(false);
	});
});
