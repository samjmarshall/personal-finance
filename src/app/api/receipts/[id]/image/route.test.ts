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

const { image, constructed } = vi.hoisted(() => ({
	image: vi.fn<(request: Request, id: string) => Promise<Response>>(
		async () => new Response("ok"),
	),
	constructed: vi.fn(),
}));
vi.mock("~/server/receipts/receipts.http.controller", () => ({
	ReceiptsHttpController: class {
		constructor(deps: unknown) {
			constructed(deps);
		}
		image = image;
	},
}));

const { GET } = await import("./route");

const call = (id: string) =>
	GET(new Request(`https://ledger.test/api/receipts/${id}/image`), {
		params: Promise.resolve({ id }),
	});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/receipts/[id]/image", () => {
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
			component: "image-route",
		});
		expect(image).toHaveBeenCalledTimes(2);
		expect(image.mock.calls[0]?.[0]).toBeInstanceOf(Request);
		expect(image.mock.calls.map(([, id]) => id)).toEqual(["3", "4"]);
		await expect(first.text()).resolves.toBe("ok");
	});
});
