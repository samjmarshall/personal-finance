import { beforeEach, describe, expect, it, vi } from "vitest";

// The route is a composition root: it builds the controller once and delegates.
// Everything it wires is stubbed so this stays a unit over that job; the gates
// themselves are covered by receipts.http.controller.test.ts.
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

const { html, constructed } = vi.hoisted(() => ({
	html: vi.fn<(request: Request, id: string) => Promise<Response>>(
		async () => new Response("ok"),
	),
	constructed: vi.fn(),
}));
vi.mock("~/server/receipts/receipts.http.controller", () => ({
	ReceiptsHttpController: class {
		constructor(deps: unknown) {
			constructed(deps);
		}
		html = html;
	},
}));

const { GET } = await import("./route");

const call = (id: string) =>
	GET(new Request(`https://ledger.test/api/receipts/${id}/html`), {
		params: Promise.resolve({ id }),
	});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/receipts/[id]/html", () => {
	it("builds the controller once over the shared service, and delegates each request with its id", async () => {
		const first = await call("3");
		await call("4");

		expect(constructed).toHaveBeenCalledTimes(1);
		expect(constructed).toHaveBeenCalledWith({
			service: { name: "receiptsService" },
			sessions: expect.objectContaining({ name: "sessionReader" }),
			logger: { name: "logger" },
		});
		expect(loggerWith).toHaveBeenCalledWith({
			domain: "receipts",
			component: "html-route",
		});
		expect(html).toHaveBeenCalledTimes(2);
		expect(html.mock.calls[0]?.[0]).toBeInstanceOf(Request);
		expect(html.mock.calls.map(([, id]) => id)).toEqual(["3", "4"]);
		await expect(first.text()).resolves.toBe("ok");
	});
});
