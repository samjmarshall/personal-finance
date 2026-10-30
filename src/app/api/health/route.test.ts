import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "~/test/fakes";

// The route is a readiness probe: it runs one `select 1` against the module-scope
// `db` and maps success/failure to 200/503. The db is stubbed so this stays a unit
// over that mapping, not a live connection.
const { execute } = vi.hoisted(() => ({
	execute: vi.fn<() => Promise<unknown>>(async () => [{ "?column?": 1 }]),
}));
vi.mock("~/server/db", () => ({ db: { execute } }));
// `connection()` throws outside a Next request scope, so stub it.
const { connection } = vi.hoisted(() => ({
	connection: vi.fn(async () => {}),
}));
vi.mock("next/server", () => ({ connection }));

const { GET } = await import("./route");

afterEach(() => vi.restoreAllMocks());

describe("GET /api/health", () => {
	it("200s with { status: 'ok' } when the readiness query resolves", async () => {
		const response = await GET();

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ok" });
		expect(execute).toHaveBeenCalledTimes(1);
	});

	// Under cacheComponents a GET with no request data prerenders at build, where
	// there is no db. connection() must come first to keep the query per request.
	it("waits for connection() before the readiness query", async () => {
		const { promise, resolve } = deferred<void>();
		connection.mockReturnValueOnce(promise);

		const response = GET();
		await Promise.resolve();
		expect(execute).not.toHaveBeenCalled();

		resolve();
		expect((await response).status).toBe(200);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	// A failed connection must surface as an unhealthy probe, not a thrown 500, so
	// the load balancer stops routing to a deployment that can't reach its db.
	it("503s with { status: 'error' } when the readiness query rejects", async () => {
		execute.mockRejectedValueOnce(new Error("connection refused"));

		const response = await GET();

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ status: "error" });
	});
});
