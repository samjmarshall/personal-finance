import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushAfterResponse } from "~/server/observability/sdk/flush.fake";

// The route is a composition root: it builds the controller once, delegates, and
// schedules the telemetry flush. Everything it wires is stubbed so this stays a
// unit over that job; the handshake itself is covered by
// receipts.http.controller.test.ts.
vi.mock(
	"~/server/observability/sdk/flush",
	() => import("~/server/observability/sdk/flush.fake"),
);
vi.mock("~/server/receipts/receipts.module", () => ({
	receiptsService: { name: "receiptsService" },
}));
vi.mock("~/server/auth/session-reader", () => ({
	BetterAuthSessionReader: class {
		readonly name = "sessionReader";
	},
}));
const { loggerWith } = vi.hoisted(() => ({
	loggerWith: vi.fn(() => ({ name: "logger" })),
}));
vi.mock("~/server/observability/logging/logger", () => ({
	createRootLogger: () => ({ with: loggerWith }),
}));

const { upload, constructed } = vi.hoisted(() => ({
	upload: vi.fn<(request: Request) => Promise<Response>>(
		async () => new Response("ok"),
	),
	constructed: vi.fn(),
}));
vi.mock("~/server/receipts/receipts.http.controller", () => ({
	ReceiptsHttpController: class {
		constructor(deps: unknown) {
			constructed(deps);
		}
		upload = upload;
	},
}));

const { POST } = await import("./route");

const post = () =>
	POST(
		new Request("https://ledger.test/api/receipts/upload", {
			method: "POST",
			body: "{}",
		}),
	);

beforeEach(() => vi.clearAllMocks());

describe("POST /api/receipts/upload", () => {
	// One controller for the life of the module, built on the first request.
	it("builds the controller once over the shared service, delegates every request, and flushes after each", async () => {
		const first = await post();
		await post();

		expect(constructed).toHaveBeenCalledTimes(1);
		expect(constructed).toHaveBeenCalledWith({
			service: { name: "receiptsService" },
			sessions: expect.objectContaining({ name: "sessionReader" }),
			logger: { name: "logger" },
		});
		expect(loggerWith).toHaveBeenCalledWith({
			domain: "receipts",
			component: "upload-route",
		});
		expect(upload).toHaveBeenCalledTimes(2);
		expect(upload.mock.calls[0]?.[0]).toBeInstanceOf(Request);
		expect(flushAfterResponse).toHaveBeenCalledTimes(2);
		await expect(first.text()).resolves.toBe("ok");
	});
});
