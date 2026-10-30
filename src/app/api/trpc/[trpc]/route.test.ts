import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

// route.ts is a composition root over the whole app router; stub what it wires
// so this stays a unit over the pre-procedure error report.
vi.mock("~/server/api/root", () => ({ appRouter: {} }));
vi.mock("~/server/api/context", () => ({ createTRPCContext: vi.fn() }));
vi.mock("~/server/api/trpc", () => ({ trpcLogger: { error: vi.fn() } }));
vi.mock(
	"~/server/observability/sdk/flush",
	() => import("~/server/observability/sdk/flush.fake"),
);
vi.mock("~/server/observability/errors/posthog", () => ({
	captureException: vi.fn(),
}));

const { reportPreProcedureError } = await import("./route");
const { captureException } = await import(
	"~/server/observability/errors/posthog"
);

describe("reportPreProcedureError", () => {
	it("captures a 500 with no ctx — it failed before any procedure ran", () => {
		const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

		reportPreProcedureError({ error, ctx: undefined, path: "receipt.list" });

		expect(captureException).toHaveBeenCalledWith(error, {
			"trpc.path": "receipt.list",
		});
	});

	it("captures any server-fault code, not just a 500", () => {
		const error = new TRPCError({ code: "SERVICE_UNAVAILABLE" });

		reportPreProcedureError({ error, ctx: undefined, path: "receipt.list" });

		expect(captureException).toHaveBeenCalledWith(error, {
			"trpc.path": "receipt.list",
		});
	});

	it("captures a batch's shared error once", () => {
		const error = new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

		reportPreProcedureError({ error, ctx: undefined, path: "receipt.list" });
		reportPreProcedureError({ error, ctx: undefined, path: "expense.list" });

		expect(captureException).toHaveBeenCalledOnce();
	});

	// With a ctx the procedure ran, so the middleware already reported it.
	it("skips an error that has a ctx", () => {
		reportPreProcedureError({
			error: new TRPCError({ code: "INTERNAL_SERVER_ERROR" }),
			ctx: {},
			path: "receipt.list",
		});

		expect(captureException).not.toHaveBeenCalled();
	});

	it("skips a client fault with no ctx", () => {
		reportPreProcedureError({
			error: new TRPCError({ code: "BAD_REQUEST" }),
			ctx: undefined,
			path: undefined,
		});

		expect(captureException).not.toHaveBeenCalled();
	});
});
