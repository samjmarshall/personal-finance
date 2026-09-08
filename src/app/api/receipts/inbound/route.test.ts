import { beforeEach, describe, expect, it, vi } from "vitest";

// The route wires the real client, db and blob store at request time. Stub every
// one of them so this stays a pure unit over the gate order.
vi.mock("~/env", () => ({
	env: { RESEND_API_KEY: "re_test", RESEND_WEBHOOK_SECRET: "whsec_test" },
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/outbox", () => ({ commitWithOutbox: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("resend", () => ({
	Resend: class {
		webhooks = { verify };
		emails = {
			receiving: { get: vi.fn(), attachments: { list: vi.fn() } },
		};
	},
}));

// Keep the real event schema; swap only the ingestion core, which is covered by
// its own suite.
const { run } = vi.hoisted(() => ({
	run: vi.fn(async () => ({ status: "dropped" as const })),
}));
vi.mock("~/server/receipts/email-ingest", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/receipts/email-ingest")>()),
	makeRunIngestInboundEmail: () => run,
}));

const { POST } = await import("./route");

const SIGNED_HEADERS = {
	"svix-id": "msg_1",
	"svix-timestamp": "1700000000",
	"svix-signature": "v1,abc",
};

const RECEIVED_EVENT = {
	type: "email.received",
	data: { email_id: "email-1", from: "sam@example.com", attachments: [] },
};

function post(body: unknown, headers: Record<string, string> = SIGNED_HEADERS) {
	return POST(
		new Request("https://ledger.test/api/receipts/inbound", {
			method: "POST",
			body: typeof body === "string" ? body : JSON.stringify(body),
			headers,
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	verify.mockReturnValue(RECEIVED_EVENT);
});

describe("POST /api/receipts/inbound", () => {
	// The signature is the only thing standing between this route and the open
	// internet, so nothing downstream may run before it passes.
	it.each(["svix-id", "svix-timestamp", "svix-signature"])(
		"401s when %s is absent",
		async (missing) => {
			const headers = { ...SIGNED_HEADERS };
			delete headers[missing as keyof typeof headers];

			const response = await post(RECEIVED_EVENT, headers);

			expect(response.status).toBe(401);
			expect(run).not.toHaveBeenCalled();
		},
	);

	it("401s when the signature does not verify, without consulting the allowlist", async () => {
		verify.mockImplementation(() => {
			throw new Error("no match");
		});

		const response = await post(RECEIVED_EVENT);

		expect(response.status).toBe(401);
		expect(run).not.toHaveBeenCalled();
	});

	// Verification is over the exact bytes received; a re-serialised object is not
	// those bytes, so a parsed body could never be checked.
	it("verifies the raw body it was sent", async () => {
		const raw = JSON.stringify(RECEIVED_EVENT);

		await post(raw);

		expect(verify).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: raw,
				webhookSecret: "whsec_test",
			}),
		);
	});

	it("ingests a verified email.received", async () => {
		const response = await post(RECEIVED_EVENT);

		expect(response.status).toBe(200);
		expect(run).toHaveBeenCalledWith(RECEIVED_EVENT);
	});

	// A drop is a verdict, not a failure. A non-200 would have Svix redeliver it.
	it("200s a dropped sender", async () => {
		run.mockResolvedValue({ status: "dropped" });

		const response = await post(RECEIVED_EVENT);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "dropped" });
	});

	// One endpoint receives every event type subscribed on the Resend side.
	it("ignores a verified event of another type", async () => {
		verify.mockReturnValue({
			type: "email.delivered",
			data: { email_id: "email-1", from: "sam@example.com" },
		});

		const response = await post({ type: "email.delivered" });

		expect(response.status).toBe(200);
		expect(run).not.toHaveBeenCalled();
	});

	it("ignores a verified payload that does not match the event shape", async () => {
		verify.mockReturnValue({ type: "email.received", data: { nope: true } });

		const response = await post({ nope: true });

		expect(response.status).toBe(200);
		expect(run).not.toHaveBeenCalled();
	});

	// Svix retries on 5xx, which is what an expiring download URL deserves.
	it("lets a genuine processing failure surface rather than swallowing it", async () => {
		run.mockRejectedValue(new Error("blob store down"));

		await expect(post(RECEIVED_EVENT)).rejects.toThrow("blob store down");
	});
});
