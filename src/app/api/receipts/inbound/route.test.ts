import { afterEach, describe, expect, it, vi } from "vitest";
import { flushAfterResponse } from "~/server/observability/sdk/flush.fake";

// The route is a composition root: it reads the env, builds the tiers once, and
// delegates. Everything it wires is stubbed so this stays a unit over that job;
// the gate order itself is covered by email.http.controller.test.ts.
const { env } = vi.hoisted(() => ({
	env: {
		RESEND_API_KEY: "re_test" as string | undefined,
		RESEND_WEBHOOK_SECRET: "whsec_test" as string | undefined,
		PROJECT_NAME: "personal-finance",
		LOG_LEVEL: "info",
	},
}));
// The root logger re-exports LogLevel from ~/env, so the mock must carry it too.
vi.mock("~/env", () => ({
	env,
	LogLevel: { DEBUG: "debug", INFO: "info", WARN: "warn", ERROR: "error" },
}));
vi.mock("~/server/allowed-senders/allowed-senders.module", () => ({
	allowedSendersService: {},
}));
vi.mock("~/server/receipts/receipts.module", () => ({ receiptsService: {} }));
vi.mock("resend", () => ({
	Resend: class {
		readonly apiKey: string;
		webhooks = {};
		emails = {};
		constructor(apiKey: string) {
			this.apiKey = apiKey;
		}
	},
}));

vi.mock(
	"~/server/observability/sdk/flush",
	() => import("~/server/observability/sdk/flush.fake"),
);

const { handle, constructed } = vi.hoisted(() => ({
	handle: vi.fn<(request: Request) => Promise<Response>>(
		async () => new Response("ok"),
	),
	constructed: vi.fn(),
}));
vi.mock("~/server/email/email.http.controller", () => ({
	EmailHttpController: class {
		constructor(deps: unknown) {
			constructed(deps);
		}
		handle = handle;
	},
}));

const { POST } = await import("./route");

const post = () =>
	POST(
		new Request("https://ledger.test/api/receipts/inbound", {
			method: "POST",
			body: "{}",
		}),
	);

afterEach(() => {
	env.RESEND_API_KEY = "re_test";
	env.RESEND_WEBHOOK_SECRET = "whsec_test";
	vi.restoreAllMocks();
});

describe("POST /api/receipts/inbound", () => {
	// Both env vars are optional outside production; an unconfigured deployment must
	// refuse rather than verify against an empty secret.
	it.each(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"] as const)(
		"500s without touching the controller when %s is unset",
		async (key) => {
			env[key] = undefined;

			const response = await post();

			expect(response.status).toBe(500);
			expect(handle).not.toHaveBeenCalled();
		},
	);

	// Scheduled before the config gate, so even a refused request drains.
	it("schedules a telemetry flush before the config gate", async () => {
		env.RESEND_API_KEY = undefined;

		const response = await post();

		expect(flushAfterResponse).toHaveBeenCalled();
		expect(response.status).toBe(500);
	});

	// One controller for the life of the module: the Resend client and the tiers
	// behind it are built on the first request and reused by every later one.
	it("builds the controller once — secret + a Resend client on the key — and delegates every request", async () => {
		const first = await post();
		await post();

		expect(constructed).toHaveBeenCalledTimes(1);
		expect(constructed).toHaveBeenCalledWith(
			expect.objectContaining({
				webhookSecret: "whsec_test",
				resend: expect.objectContaining({ apiKey: "re_test" }),
			}),
		);
		expect(handle).toHaveBeenCalledTimes(2);
		expect(handle.mock.calls[0]?.[0]).toBeInstanceOf(Request);
		await expect(first.text()).resolves.toBe("ok");
	});
});
