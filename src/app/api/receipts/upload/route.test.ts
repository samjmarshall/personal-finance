import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { HandleUploadOptions } from "@vercel/blob/client";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Logger } from "~/server/observability/logger";
import { ContextSpanProcessor } from "~/server/observability/span-processor";

// The route opens a span over Blob's handleUpload: it gates on the session,
// stamps the member on its span, logs the refusals and echoes the trace id. Blob,
// auth, the flush and the logger are stubbed so this stays a unit over that job.
vi.mock("~/env", () => ({
	env: { PROJECT_NAME: "personal-finance", LOG_LEVEL: "info" },
	LogLevel: { DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" },
}));

const { flushAfterResponse } = vi.hoisted(() => ({
	flushAfterResponse: vi.fn(),
}));
vi.mock("~/server/observability/flush", () => ({ flushAfterResponse }));

const { getSession } = vi.hoisted(() => ({
	getSession: vi.fn<() => Promise<{ user: { id: string } } | null>>(),
}));
vi.mock("~/server/auth", () => ({ auth: { api: { getSession } } }));

const { logs } = vi.hoisted(() => ({
	logs: [] as Array<{
		level: string;
		msg: string;
		attrs?: Record<string, unknown>;
	}>,
}));
vi.mock("~/server/observability/logger", () => {
	const fake: Logger = {
		debug: (msg, attrs) => void logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs) => void logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs) => void logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs) => void logs.push({ level: "error", msg, attrs }),
		with: () => fake,
	};
	return { createRootLogger: () => fake };
});

// Real handleUpload awaits onBeforeGenerateToken inside, so a throw there (the
// session gate) surfaces as a rejection — the fake keeps that contract.
const { handleUpload } = vi.hoisted(() => ({
	handleUpload: vi.fn(async (opts: HandleUploadOptions) => {
		if (opts.body.type === "blob.upload-completed") {
			await opts.onUploadCompleted?.(opts.body.payload);
			return { type: opts.body.type, response: "ok" as const };
		}
		const token = await opts.onBeforeGenerateToken(
			opts.body.payload.pathname,
			null,
			false,
		);
		return { type: opts.body.type, clientToken: `tok:${token.tokenPayload}` };
	}),
}));
vi.mock("@vercel/blob/client", () => ({ handleUpload }));

const { POST } = await import("./route");

// A registered provider makes the ambient tracer record, so the span the route
// opens lands in the exporter and currentTraceId() sees it. The real
// ContextSpanProcessor rides along: the member reaches the span only via baggage.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [
		new ContextSpanProcessor(),
		new SimpleSpanProcessor(exporter),
	],
});
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => {
	vi.clearAllMocks();
	exporter.reset();
	logs.length = 0;
	getSession.mockResolvedValue({ user: { id: "m1" } });
});

const tokenEvent = {
	type: "blob.generate-client-token",
	payload: {
		pathname: "receipt.jpg",
		callbackUrl: "https://ledger.test/api/receipts/upload",
		clientPayload: null,
		multipart: false,
	},
};
const post = (body: string = JSON.stringify(tokenEvent)) =>
	POST(
		new Request("https://ledger.test/api/receipts/upload", {
			method: "POST",
			body,
		}),
	);

describe("POST /api/receipts/upload", () => {
	it("400s a malformed body before minting, with the flush still scheduled", async () => {
		const response = await post("{not json");

		expect(response.status).toBe(400);
		expect(handleUpload).not.toHaveBeenCalled();
		expect(flushAfterResponse).toHaveBeenCalled();
		expect(exporter.getFinishedSpans()).toEqual([]);
	});

	// In prod Next's HTTP span wraps the whole handler, so even the early 400 has a
	// trace to name (adr020). Stand in for that span here and check the echo.
	it("echoes the ambient trace id on the malformed-body 400", async () => {
		const http = provider
			.getTracer("test")
			.startSpan("POST /api/receipts/upload");
		try {
			const response = await context.with(
				trace.setSpan(context.active(), http),
				() => post("{not json"),
			);

			expect(response.status).toBe(400);
			expect(response.headers.get("x-trace-id")).toBe(
				http.spanContext().traceId,
			);
		} finally {
			http.end();
		}
	});

	it("400s a JSON null body before minting, without opening a span", async () => {
		const response = await post("null");

		expect(response.status).toBe(400);
		expect(handleUpload).not.toHaveBeenCalled();
		expect(exporter.getFinishedSpans()).toEqual([]);
	});

	it("mints under a blob.token.mint span stamped with the member, and echoes its trace id", async () => {
		const response = await post();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			type: "blob.generate-client-token",
			clientToken: 'tok:{"userId":"m1"}',
		});

		const [span] = exporter.getFinishedSpans();
		expect(span?.name).toBe("blob.token.mint");
		expect(span?.attributes).toMatchObject({
			"blob.event_type": "blob.generate-client-token",
			"blob.pathname": "receipt.jpg",
			"member.id": "m1",
			"posthog.distinct_id": "m1",
		});
		expect(response.headers.get("x-trace-id")).toBe(
			span?.spanContext().traceId,
		);
		expect(logs).toEqual([]);
	});

	// In production Blob calls back with upload-completed: no browser, no session.
	it("names the completion webhook span blob.upload.completed and skips the session gate", async () => {
		const response = await post(
			JSON.stringify({
				type: "blob.upload-completed",
				payload: {
					blob: {
						url: "https://blob.test/receipt.jpg",
						pathname: "receipt.jpg",
					},
					tokenPayload: null,
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(getSession).not.toHaveBeenCalled();
		const [span] = exporter.getFinishedSpans();
		expect(span?.name).toBe("blob.upload.completed");
		expect(span?.attributes).toMatchObject({
			"blob.event_type": "blob.upload-completed",
		});
	});

	// A signed-out tab is routine: warn on the trace so the id is searchable, but
	// leave the span un-errored so Error Tracking only sees real mint failures.
	it("401s a signed-out request with a warn log and a clean span", async () => {
		getSession.mockResolvedValue(null);

		const response = await post();

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
		expect(logs).toEqual([
			{
				level: "warn",
				msg: "blob token mint refused",
				attrs: { "blob.event_type": "blob.generate-client-token" },
			},
		]);
		const [span] = exporter.getFinishedSpans();
		expect(span?.status.code).toBe(SpanStatusCode.UNSET);
		expect(span?.attributes["http.response.status_code"]).toBe(401);
		expect(response.headers.get("x-trace-id")).toBe(
			span?.spanContext().traceId,
		);
	});

	it("400s any other mint failure, recording it on the span and logging at error", async () => {
		handleUpload.mockRejectedValueOnce(new Error("boom"));

		const response = await post();

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "boom" });
		const [span] = exporter.getFinishedSpans();
		expect(span?.status).toEqual({
			code: SpanStatusCode.ERROR,
			message: "boom",
		});
		expect(span?.attributes["http.response.status_code"]).toBe(400);
		expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			level: "error",
			msg: "blob event failed",
		});
		expect(logs[0]?.attrs?.error).toBeInstanceOf(Error);
	});
});
