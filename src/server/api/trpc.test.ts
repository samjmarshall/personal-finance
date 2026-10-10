import { SpanStatusCode } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { TRPCError } from "@trpc/server";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	createTestCaller,
	type TestCallerOptions,
} from "~/server/api/test-caller";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import { SpanAttributeProcessor } from "~/server/observability/sdk/span-processor";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [
		// Registered so span-start baggage stamping is exercised, not just export.
		new SpanAttributeProcessor(),
		new SimpleSpanProcessor(exporter),
	],
});

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());
// stdout is spied in the failure tests; restore it even if an assertion throws.
afterEach(() => vi.restoreAllMocks());

const notFound = new NotFoundError("gone");
const conflict = new ConflictError("taken");
const invalid = new InvalidInputError("bad path");

const router = createTRPCRouter({
	ok: publicProcedure.query(() => "result"),
	boom: publicProcedure.query(() => {
		throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
	}),
	bad: publicProcedure.query(() => {
		throw new TRPCError({ code: "BAD_REQUEST" });
	}),
	badWithMessage: publicProcedure.query(() => {
		throw new TRPCError({ code: "BAD_REQUEST", message: "nope" });
	}),
	badWithDomainCause: publicProcedure.query(() => {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "nope",
			cause: notFound,
		});
	}),
	unauth: publicProcedure.query(() => {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}),
	notFound: publicProcedure.query(() => {
		throw notFound;
	}),
	conflict: publicProcedure.query(() => {
		throw conflict;
	}),
	invalid: publicProcedure.query(() => {
		throw invalid;
	}),
	plain: publicProcedure.query(() => {
		throw new Error("plain");
	}),
	protectedNotFound: protectedProcedure.query(() => {
		throw notFound;
	}),
});

function caller(options?: TestCallerOptions) {
	return createTestCaller(router, options);
}

describe("dev latency (default test env is dev)", () => {
	it("resolves after the artificial delay and passes the result through", async () => {
		const start = Date.now();
		const result = await caller().ok();
		expect(result).toBe("result");
		expect(Date.now() - start).toBeGreaterThanOrEqual(100);
	});
});

describe("production has no artificial delay", () => {
	it("resolves in well under the dev floor", async () => {
		vi.resetModules();
		vi.stubEnv("NODE_ENV", "production");
		const trpc = await import("~/server/api/trpc");
		const testCaller = await import("~/server/api/test-caller");
		const prodRouter = trpc.createTRPCRouter({
			ok: trpc.publicProcedure.query(() => "result"),
		});
		const prodCaller = testCaller.createTestCaller(prodRouter, {
			session: null,
		});

		const start = Date.now();
		await expect(prodCaller.ok()).resolves.toBe("result");
		expect(Date.now() - start).toBeLessThan(50);
	});
});

describe("tracing span", () => {
	it("records ERROR + trpc.error_code on an INTERNAL_SERVER_ERROR", async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await expect(caller().boom()).rejects.toThrow();

		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "trpc.boom");
		expect(span).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.status.code).toBe(SpanStatusCode.ERROR);
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.attributes["trpc.error_code"]).toBe("INTERNAL_SERVER_ERROR");
	});

	it("records ERROR + trpc.error_code on a BAD_REQUEST", async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		await expect(caller().bad()).rejects.toThrow();

		const span = exporter.getFinishedSpans().find((s) => s.name === "trpc.bad");
		expect(span).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.status.code).toBe(SpanStatusCode.ERROR);
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.attributes["trpc.error_code"]).toBe("BAD_REQUEST");
	});

	it("a successful call logs nothing to stdout", async () => {
		const lines: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		});
		await caller().ok();
		expect(lines).toHaveLength(0);
	});

	it("stamps member.id + posthog.distinct_id from baggage set before the span", async () => {
		await caller({ session: { user: { id: "member-1" } } }).ok();

		const span = exporter.getFinishedSpans().find((s) => s.name === "trpc.ok");
		expect(span).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.attributes["member.id"]).toBe("member-1");
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.attributes["posthog.distinct_id"]).toBe("member-1");
	});

	it("an expected client fault (UNAUTHORIZED) tags the code but doesn't fail the span or log", async () => {
		const lines: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		});
		await expect(caller().unauth()).rejects.toThrow();

		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "trpc.unauth");
		expect(span).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.status.code).toBe(SpanStatusCode.UNSET);
		// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
		expect(span!.attributes["trpc.error_code"]).toBe("UNAUTHORIZED");
		expect(lines).toHaveLength(0);
	});

	// The logger owns the never-throw guarantee (it swallows a dead sink and falls
	// back to console), so a broken sink can't change the result or fire trpc's own
	// observability_sink_failed catch — that catch now only guards span/captureException.
	it("a broken log sink can't fail the request — the logger swallows it and falls back to console", async () => {
		vi.spyOn(process.stdout, "write").mockImplementation(() => {
			throw new Error("stdout down");
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await expect(caller().boom()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining("logging_failed"),
		);
	});
});

function captureStdout(): string[] {
	const lines: string[] = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		if (typeof chunk === "string") lines.push(chunk);
		return true;
	});
	return lines;
}

function spanNamed(name: string) {
	const span = exporter.getFinishedSpans().find((s) => s.name === name);
	expect(span).toBeDefined();
	// biome-ignore lint/style/noNonNullAssertion: asserted defined above.
	return span!;
}

describe("error mapping", () => {
	it("maps a NotFoundError to NOT_FOUND, keeping its message and cause", async () => {
		await expect(caller().notFound()).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "gone",
			cause: notFound,
		});
	});

	it("maps a ConflictError to CONFLICT, keeping its message and cause", async () => {
		captureStdout();
		await expect(caller().conflict()).rejects.toMatchObject({
			code: "CONFLICT",
			message: "taken",
			cause: conflict,
		});
	});

	it("maps an InvalidInputError to BAD_REQUEST, keeping its message and cause", async () => {
		captureStdout();
		await expect(caller().invalid()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "bad path",
			cause: invalid,
		});
	});

	it("keeps the domain error's stack so traces show where it was thrown", async () => {
		captureStdout();
		const error = await caller()
			.conflict()
			.catch((e: unknown) => e);
		expect((error as Error).stack).toBe(conflict.stack);
	});

	it("leaves an unknown Error as INTERNAL_SERVER_ERROR", async () => {
		captureStdout();
		await expect(caller().plain()).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
	});

	it("passes a deliberate TRPCError through unchanged", async () => {
		captureStdout();
		await expect(caller().badWithMessage()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "nope",
		});
	});

	it("keeps a deliberate TRPCError's code even when its cause is a domain error", async () => {
		captureStdout();
		await expect(caller().badWithDomainCause()).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "nope",
		});
	});

	it("observability sees NOT_FOUND as expected: span UNSET, no stdout", async () => {
		const lines = captureStdout();
		await expect(caller().notFound()).rejects.toThrow();

		const span = spanNamed("trpc.notFound");
		expect(span.status.code).toBe(SpanStatusCode.UNSET);
		expect(span.attributes["trpc.error_code"]).toBe("NOT_FOUND");
		expect(lines).toHaveLength(0);
	});

	it("observability fails the span on CONFLICT and warns, but doesn't report a crash", async () => {
		const lines = captureStdout();
		await expect(caller().conflict()).rejects.toThrow();

		const span = spanNamed("trpc.conflict");
		expect(span.status.code).toBe(SpanStatusCode.ERROR);
		expect(span.attributes["trpc.error_code"]).toBe("CONFLICT");
		const output = lines.join("");
		expect(output).toContain("trpc request failed");
		expect(output).not.toContain("trpc internal error");
	});

	it("protectedProcedure maps a NotFoundError too", async () => {
		await expect(caller().protectedNotFound()).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "gone",
		});
	});

	it("protectedProcedure still rejects a signed-out call with UNAUTHORIZED", async () => {
		await expect(
			caller({ session: null }).protectedNotFound(),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});
