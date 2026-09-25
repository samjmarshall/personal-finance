import { SpanStatusCode } from "@opentelemetry/api";
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
import type { InboundEmailEvent } from "~/domain/email";
import type { LogAttributes, Logger } from "~/server/observability/logger";
import { EmailController } from "./email.controller";
import type { EmailService, IngestResult } from "./email.service";

const SIGNED_HEADERS = {
	"svix-id": "msg_1",
	"svix-timestamp": "1700000000",
	"svix-signature": "v1,abc",
};

const RECEIVED_EVENT = {
	type: "email.received",
	data: { email_id: "email-1", from: "sam@example.com", attachments: [] },
};

type LogEntry = { level: string; msg: string; attrs: LogAttributes };

// The email.inbound span lands on the ambient tracer; register a provider so
// start/end are recorded and the span can be asserted per verified event.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

// Spy verifier + fake service: the controller is a pure unit over the gate order.
function harness() {
	const verify = vi.fn(() => RECEIVED_EVENT);
	const ingest = vi.fn<(event: InboundEmailEvent) => Promise<IngestResult>>(
		async () => ({ status: "dropped" }),
	);
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};
	const controller = new EmailController({
		// biome-ignore lint/suspicious/noExplicitAny: narrow stand-in for the Resend client.
		resend: { webhooks: { verify } } as any,
		webhookSecret: "whsec_test",
		service: { ingest } as unknown as EmailService,
		logger,
	});

	const post = (
		body: unknown,
		headers: Record<string, string> = SIGNED_HEADERS,
	) =>
		controller.handle(
			new Request("https://ledger.test/api/receipts/inbound", {
				method: "POST",
				body: typeof body === "string" ? body : JSON.stringify(body),
				headers,
			}),
		);

	return { post, verify, ingest, logs };
}

describe("EmailController.handle", () => {
	// The signature is the only thing standing between this route and the open
	// internet, so nothing downstream may run before it passes.
	it.each(["svix-id", "svix-timestamp", "svix-signature"])(
		"401s when %s is absent",
		async (missing) => {
			const h = harness();
			const headers = { ...SIGNED_HEADERS };
			delete headers[missing as keyof typeof headers];

			const response = await h.post(RECEIVED_EVENT, headers);

			expect(response.status).toBe(401);
			expect(h.verify).not.toHaveBeenCalled();
			expect(h.ingest).not.toHaveBeenCalled();
		},
	);

	it("401s when the signature does not verify, without consulting the service", async () => {
		const h = harness();
		h.verify.mockImplementation(() => {
			throw new Error("no match");
		});

		const response = await h.post(RECEIVED_EVENT);

		expect(response.status).toBe(401);
		expect(h.ingest).not.toHaveBeenCalled();
	});

	// Verification is over the exact bytes received; a re-serialised object is not
	// those bytes, so a parsed body could never be checked.
	it("verifies the raw body it was sent, with the configured secret", async () => {
		const h = harness();
		const raw = JSON.stringify(RECEIVED_EVENT);

		await h.post(raw);

		expect(h.verify).toHaveBeenCalledWith({
			payload: raw,
			headers: { id: "msg_1", timestamp: "1700000000", signature: "v1,abc" },
			webhookSecret: "whsec_test",
		});
	});

	it("ingests a verified email.received and returns the verdict", async () => {
		const h = harness();
		h.ingest.mockResolvedValue({ status: "ingested", receiptIds: [7] });

		const response = await h.post(RECEIVED_EVENT);

		expect(response.status).toBe(200);
		expect(h.ingest).toHaveBeenCalledWith(RECEIVED_EVENT);
		await expect(response.json()).resolves.toEqual({
			status: "ingested",
			receiptIds: [7],
		});
	});

	// A drop is a verdict, not a failure. A non-200 would have Svix redeliver it.
	it("200s a dropped sender", async () => {
		const h = harness();

		const response = await h.post(RECEIVED_EVENT);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "dropped" });
	});

	// One endpoint receives every event type subscribed on the Resend side.
	it("ignores a verified event of another type", async () => {
		const h = harness();
		h.verify.mockReturnValue({
			type: "email.delivered",
			data: { email_id: "email-1", from: "sam@example.com", attachments: [] },
		});

		const response = await h.post({ type: "email.delivered" });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ignored" });
		expect(h.ingest).not.toHaveBeenCalled();
	});

	it("ignores a verified payload that does not match the event shape", async () => {
		const h = harness();
		h.verify.mockReturnValue({
			type: "email.received",
			data: { nope: true },
		} as never);

		const response = await h.post({ nope: true });

		expect(response.status).toBe(200);
		expect(h.ingest).not.toHaveBeenCalled();
	});

	// Svix retries on 5xx, which is what an expiring download URL deserves.
	it("lets a genuine processing failure surface rather than swallowing it", async () => {
		const h = harness();
		h.ingest.mockRejectedValue(new Error("blob store down"));

		await expect(h.post(RECEIVED_EVENT)).rejects.toThrow("blob store down");

		const failed = h.logs.filter((l) => l.msg === "inbound email failed");
		expect(failed).toHaveLength(1);
		expect(failed[0]?.level).toBe("error");
		expect(failed[0]?.attrs["email.id"]).toBe("email-1");

		// The failure must show red in the trace view, with the exception recorded.
		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
		expect(spans[0]?.events.map((e) => e.name)).toContain("exception");
	});

	// The span is the root of the inbound trace; it must exist for a verified event
	// and never for a caller the signature rejected.
	it("opens one email.inbound span for a verified event", async () => {
		const h = harness();

		await h.post(RECEIVED_EVENT);

		const spans = exporter.getFinishedSpans();
		expect(spans).toHaveLength(1);
		expect(spans[0]?.name).toBe("email.inbound");
		expect(spans[0]?.attributes["email.id"]).toBe("email-1");
		expect(spans[0]?.attributes["email.event_type"]).toBe("email.received");
	});

	it("tags the span with the minted receipt ids", async () => {
		const h = harness();
		h.ingest.mockResolvedValue({ status: "ingested", receiptIds: [1, 2] });

		await h.post(RECEIVED_EVENT);

		const [span] = exporter.getFinishedSpans();
		expect(span?.attributes["receipt.ids"]).toEqual([1, 2]);
	});

	it("opens no span for a caller the signature rejected", async () => {
		const h = harness();
		h.verify.mockImplementation(() => {
			throw new Error("no match");
		});

		const response = await h.post(RECEIVED_EVENT);

		expect(response.status).toBe(401);
		expect(exporter.getFinishedSpans()).toHaveLength(0);
	});
});
