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

import { SpanAttributeProcessor } from "~/server/observability/sdk/span-processor";

// Importing trpc pulls in the real db + auth (and through them ~/env). Stub them
// so this stays a pure unit test.
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

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

const { createTRPCRouter, publicProcedure, createCallerFactory } = await import(
	"~/server/api/trpc"
);

function caller(session: unknown = { user: { id: "member-1" } }) {
	const router = createTRPCRouter({
		ok: publicProcedure.query(() => "result"),
		boom: publicProcedure.query(() => {
			throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
		}),
		bad: publicProcedure.query(() => {
			throw new TRPCError({ code: "BAD_REQUEST" });
		}),
		unauth: publicProcedure.query(() => {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}),
	});
	return createCallerFactory(router)({
		db: {},
		session,
		headers: new Headers(),
	} as never);
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
		const router = trpc.createTRPCRouter({
			ok: trpc.publicProcedure.query(() => "result"),
		});
		const prodCaller = trpc.createCallerFactory(router)({
			db: {},
			session: null,
			headers: new Headers(),
		} as never);

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
		await caller({ user: { id: "member-1" } }).ok();

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
