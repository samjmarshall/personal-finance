import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { SessionReader } from "~/server/auth/session-reader";
import {
	InvalidInputError,
	NotFoundError,
} from "~/server/errors/domain-errors";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { SpanAttributeProcessor } from "~/server/observability/sdk/span-processor";
import { ReceiptsHttpController } from "./receipts.http.controller";
import {
	type ReceiptsService,
	UploadUnauthorizedError,
} from "./receipts.service";

// A registered provider makes the ambient tracer record, so the span the controller
// opens lands in the exporter and currentTraceId() sees it. The real
// SpanAttributeProcessor rides along: the member reaches the span only via baggage.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [
		new SpanAttributeProcessor(),
		new SimpleSpanProcessor(exporter),
	],
});
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

type LogEntry = { level: string; msg: string; attrs?: LogAttributes };

const BYTES = new Uint8Array([137, 80, 78, 71]);
const HTML = "<p>Thanks for your order</p>";
const imageBlob = (contentType = "image/png") => ({
	stream: new Blob([BYTES]).stream(),
	contentType,
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

// The fake service answers like the real one around a signed-out grant: no member
// means the grant throws, and a completion webhook never reaches a grant at all.
function harness({ memberId = "m1" }: { memberId?: string } = {}) {
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs) => void logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs) => void logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs) => void logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs) => void logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};
	const sessionMember = vi.fn<SessionReader["memberId"]>(async () => memberId);
	const openImage = vi.fn<ReceiptsService["openImage"]>(async () =>
		imageBlob(),
	);
	const openHtml = vi.fn<ReceiptsService["openHtml"]>(async () => ({
		stream: new Blob([HTML]).stream(),
		contentType: "text/html; charset=utf-8",
	}));
	const answerUpload = vi.fn<ReceiptsService["answerUpload"]>(
		async (_request, event, member) => {
			if (event.type === "blob.upload-completed") {
				return { type: event.type, response: "ok" };
			}
			if (member === undefined) throw new UploadUnauthorizedError();
			return { type: event.type, clientToken: `tok:${member}` };
		},
	);
	const controller = new ReceiptsHttpController({
		service: {
			openImage,
			openHtml,
			answerUpload,
		} as unknown as ReceiptsService,
		sessions: { memberId: sessionMember },
		logger,
	});
	return { controller, logs, sessionMember, openImage, openHtml, answerUpload };
}

// `Number()` would read "1e3" as 1000 and send 99999999999 to an int4 column.
const BAD_IDS = [
	"abc",
	"0",
	"-1",
	"1.5",
	"1e3",
	"007",
	" 3",
	"2147483648",
	"99999999999",
	"",
];

describe("ReceiptsHttpController.image", () => {
	const request = () =>
		new Request("https://ledger.test/api/receipts/3/image", {
			headers: { cookie: "session=abc" },
		});

	it("401s a signed-out request before reading anything", async () => {
		const { controller, sessionMember, openImage } = harness();
		sessionMember.mockResolvedValue(undefined);

		const response = await controller.image(request(), "3");

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Unauthorized");
		expect(openImage).not.toHaveBeenCalled();
	});

	it("reads the session from the request's own headers", async () => {
		const { controller, sessionMember } = harness();

		await controller.image(request(), "3");

		expect(sessionMember.mock.calls[0]?.[0].get("cookie")).toBe("session=abc");
	});

	it.each(BAD_IDS)("404s the id %j without opening the image", async (id) => {
		const { controller, openImage } = harness();

		const response = await controller.image(request(), id);

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe("Not found");
		expect(openImage).not.toHaveBeenCalled();
	});

	it.each([
		["1", 1],
		["2147483647", 2147483647],
	])("opens the image for the id %s", async (id, expected) => {
		const { controller, openImage } = harness();

		const response = await controller.image(request(), id);

		expect(response.status).toBe(200);
		expect(openImage).toHaveBeenCalledWith(expected);
	});

	it.each([["Receipt not found."], ["Receipt image not found."]])(
		"404s when the service says %j",
		async (message) => {
			const { controller, openImage } = harness();
			openImage.mockRejectedValue(new NotFoundError(message));

			const response = await controller.image(request(), "3");

			expect(response.status).toBe(404);
			await expect(response.text()).resolves.toBe("Not found");
		},
	);

	it("lets any other failure throw", async () => {
		const { controller, openImage } = harness();
		const failure = new Error("store down");
		openImage.mockRejectedValue(failure);

		await expect(controller.image(request(), "3")).rejects.toBe(failure);
	});

	it("streams the blob under its type with inert, uncacheable headers", async () => {
		const { controller } = harness();

		const response = await controller.image(request(), "3");

		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
		expect(response.headers.get("Content-Type")).toBe("image/png");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});
});

describe("ReceiptsHttpController.html", () => {
	const request = () =>
		new Request("https://ledger.test/api/receipts/3/html", {
			headers: { cookie: "session=abc" },
		});

	it("401s a signed-out request before reading anything", async () => {
		const { controller, sessionMember, openHtml } = harness();
		sessionMember.mockResolvedValue(undefined);

		const response = await controller.html(request(), "3");

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Unauthorized");
		expect(openHtml).not.toHaveBeenCalled();
	});

	it("reads the session from the request's own headers", async () => {
		const { controller, sessionMember } = harness();

		await controller.html(request(), "3");

		expect(sessionMember.mock.calls[0]?.[0].get("cookie")).toBe("session=abc");
	});

	it.each(BAD_IDS)("404s the id %j without opening the body", async (id) => {
		const { controller, openHtml } = harness();

		const response = await controller.html(request(), id);

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe("Not found");
		expect(openHtml).not.toHaveBeenCalled();
	});

	it("opens the body for a good id", async () => {
		const { controller, openHtml } = harness();

		await controller.html(request(), "2147483647");

		expect(openHtml).toHaveBeenCalledWith(2147483647);
	});

	it("404s when the service says the body is missing", async () => {
		const { controller, openHtml } = harness();
		openHtml.mockRejectedValue(new NotFoundError("Receipt body not found."));

		const response = await controller.html(request(), "3");

		expect(response.status).toBe(404);
		await expect(response.text()).resolves.toBe("Not found");
	});

	it("lets any other failure throw", async () => {
		const { controller, openHtml } = harness();
		const failure = new Error("store down");
		openHtml.mockRejectedValue(failure);

		await expect(controller.html(request(), "3")).rejects.toBe(failure);
	});

	it("streams the body under a locked-down CSP with inert, uncacheable headers", async () => {
		const { controller } = harness();

		const response = await controller.html(request(), "3");

		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe(HTML);
		expect(Object.fromEntries(response.headers)).toEqual({
			"content-type": "text/html; charset=utf-8",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox",
			"x-content-type-options": "nosniff",
			"cache-control": "private, no-store",
			"referrer-policy": "no-referrer",
		});
	});
});

describe("ReceiptsHttpController.upload", () => {
	const post = (
		controller: ReceiptsHttpController,
		body: string = JSON.stringify(tokenEvent),
	) =>
		controller.upload(
			new Request("https://ledger.test/api/receipts/upload", {
				method: "POST",
				body,
			}),
		);

	it("400s a malformed body before minting", async () => {
		const { controller, answerUpload, sessionMember } = harness();

		const response = await post(controller, "{not json");

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Invalid request body",
		});
		expect(answerUpload).not.toHaveBeenCalled();
		expect(sessionMember).not.toHaveBeenCalled();
		expect(exporter.getFinishedSpans()).toEqual([]);
	});

	// In prod Next's HTTP span wraps the whole handler, so even the early 400 has a
	// trace to name (adr020). Stand in for that span here and check the echo.
	it("echoes the ambient trace id on the malformed-body 400", async () => {
		const { controller } = harness();
		const http = provider
			.getTracer("test")
			.startSpan("POST /api/receipts/upload");
		try {
			const response = await context.with(
				trace.setSpan(context.active(), http),
				() => post(controller, "{not json"),
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
		const { controller, answerUpload } = harness();

		const response = await post(controller, "null");

		expect(response.status).toBe(400);
		expect(answerUpload).not.toHaveBeenCalled();
		expect(exporter.getFinishedSpans()).toEqual([]);
	});

	it.each([
		["an unknown event type", { type: "blob.nope", payload: {} }],
		[
			"a token request with no pathname",
			{ type: "blob.generate-client-token" },
		],
	])("400s %s before minting, without opening a span", async (_, body) => {
		const { controller, answerUpload } = harness();

		const response = await post(controller, JSON.stringify(body));

		expect(response.status).toBe(400);
		expect(answerUpload).not.toHaveBeenCalled();
		expect(exporter.getFinishedSpans()).toEqual([]);
	});

	it("mints under a blob.token.mint span stamped with the member, and echoes its trace id", async () => {
		const { controller, answerUpload, logs } = harness();

		const response = await post(controller);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			type: "blob.generate-client-token",
			clientToken: "tok:m1",
		});
		expect(answerUpload).toHaveBeenCalledWith(
			expect.any(Request),
			tokenEvent,
			"m1",
		);
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
	it("names the completion webhook span blob.upload.completed and skips the session read", async () => {
		const { controller, sessionMember, answerUpload } = harness();

		const response = await post(
			controller,
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
		expect(sessionMember).not.toHaveBeenCalled();
		expect(answerUpload.mock.calls[0]?.[2]).toBeUndefined();
		const [span] = exporter.getFinishedSpans();
		expect(span?.name).toBe("blob.upload.completed");
		expect(span?.attributes).toMatchObject({
			"blob.event_type": "blob.upload-completed",
		});
		expect(span?.attributes["blob.pathname"]).toBeUndefined();
	});

	// A signed-out tab is routine: warn on the trace so the id is searchable, but
	// leave the span un-errored so Error Tracking only sees real mint failures.
	it("401s a signed-out request with a warn log and a clean span", async () => {
		const { controller, sessionMember, logs } = harness();
		sessionMember.mockResolvedValue(undefined);

		const response = await post(controller);

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
		expect(span?.attributes["blob.pathname"]).toBeUndefined();
		expect(response.headers.get("x-trace-id")).toBe(
			span?.spanContext().traceId,
		);
	});

	// Past the body check, the completion callback only fails Blob's signature check.
	it("400s a rejected completion callback with a warn log and an errored span", async () => {
		const { controller, answerUpload, logs } = harness();
		answerUpload.mockRejectedValueOnce(new Error("Invalid callback signature"));

		const response = await post(
			controller,
			JSON.stringify({ type: "blob.upload-completed", payload: {} }),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Invalid callback signature",
		});
		const [span] = exporter.getFinishedSpans();
		expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
		expect(span?.attributes["http.response.status_code"]).toBe(400);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			level: "warn",
			msg: "blob callback rejected",
		});
	});

	it("400s a token request outside the upload prefix with a warn log and an errored span", async () => {
		const { controller, answerUpload, logs } = harness();
		answerUpload.mockRejectedValueOnce(new InvalidInputError("outside"));

		const response = await post(controller);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: "outside" });
		const [span] = exporter.getFinishedSpans();
		expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
		expect(span?.attributes["http.response.status_code"]).toBe(400);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			level: "warn",
			msg: "blob token mint rejected",
		});
	});

	it("500s any other mint failure, recording it on the span and logging at error", async () => {
		const { controller, answerUpload, logs } = harness();
		answerUpload.mockRejectedValueOnce(new Error("boom"));

		const response = await post(controller);

		expect(response.status).toBe(500);
		// Our own failure text (a missing store token, say) never reaches the caller.
		await expect(response.json()).resolves.toEqual({ error: "Upload failed" });
		const [span] = exporter.getFinishedSpans();
		// The raw message may carry the member's filename; it stays on the exception only.
		expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
		expect(span?.attributes["http.response.status_code"]).toBe(500);
		expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			level: "error",
			msg: "blob event failed",
		});
		expect(logs[0]?.attrs?.error).toBeInstanceOf(Error);
	});
});
