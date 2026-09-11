import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route is a readiness probe: it runs one `select 1` against the module-scope
// `db` and maps success/failure to 200/503. The db is stubbed so this stays a unit
// over that mapping, not a live connection.
const { execute } = vi.hoisted(() => ({
	execute: vi.fn<() => Promise<unknown>>(async () => [{ "?column?": 1 }]),
}));
vi.mock("~/server/db", () => ({ db: { execute } }));

const { GET } = await import("./route");

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health", () => {
	it("200s with { status: 'ok' } when the readiness query resolves", async () => {
		const response = await GET();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ok" });
		expect(execute).toHaveBeenCalledTimes(1);
	});

	// A failed connection must surface as an unhealthy probe, not a thrown 500, so
	// the load balancer stops routing to a deployment that can't reach its db.
	it("503s with { status: 'error' } and logs when the readiness query rejects", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		execute.mockRejectedValueOnce(new Error("connection refused"));

		const response = await GET();

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ status: "error" });
		expect(error).toHaveBeenCalled();
	});
});
