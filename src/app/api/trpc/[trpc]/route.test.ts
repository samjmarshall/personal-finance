import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// route.ts is a composition root over the whole app router; stub what it wires
// so this stays a unit over the context-failure report.
vi.mock("~/server/api/root", () => ({ appRouter: {} }));
vi.mock("~/server/api/trpc", () => ({ createTRPCContext: vi.fn() }));
vi.mock("~/server/observability/flush", () => ({
	flushAfterResponse: vi.fn(),
}));
vi.mock("~/server/observability/posthog", () => ({
	captureException: vi.fn(),
}));

const { reportContextFailure } = await import("./route");
const { captureException } = await import("~/server/observability/posthog");

describe("reportContextFailure", () => {
	beforeEach(() => vi.mocked(captureException).mockClear());

	it("captures a 500 with no ctx — the context build threw", () => {
		const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

		reportContextFailure({ error, ctx: undefined, path: "receipt.list" });

		expect(captureException).toHaveBeenCalledWith(error, {
			"trpc.path": "receipt.list",
		});
	});

	it("captures any server-fault code, not just a 500", () => {
		const error = new TRPCError({ code: "SERVICE_UNAVAILABLE" });

		reportContextFailure({ error, ctx: undefined, path: "receipt.list" });

		expect(captureException).toHaveBeenCalledWith(error, {
			"trpc.path": "receipt.list",
		});
	});

	// With a ctx the procedure ran, so the middleware already reported it.
	it("skips an error that has a ctx", () => {
		reportContextFailure({
			error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
			ctx: {},
			path: "receipt.list",
		});

		expect(captureException).not.toHaveBeenCalled();
	});

	it("skips a client fault with no ctx", () => {
		reportContextFailure({
			error: new TRPCError({ code: "BAD_REQUEST" }),
			ctx: undefined,
			path: undefined,
		});

		expect(captureException).not.toHaveBeenCalled();
	});
});
