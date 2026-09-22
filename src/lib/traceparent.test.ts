import { afterEach, describe, expect, it, vi } from "vitest";
import { newTraceparent } from "~/lib/traceparent";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe("newTraceparent", () => {
	afterEach(() => vi.restoreAllMocks());

	it("mints a W3C traceparent with sampled flag", () => {
		expect(newTraceparent()).toMatch(TRACEPARENT);
	});

	it("never mints an all-zero trace id or span id", () => {
		for (let i = 0; i < 50; i++) {
			const [, traceId, spanId] = newTraceparent().split("-");
			expect(traceId).not.toMatch(/^0+$/);
			expect(spanId).not.toMatch(/^0+$/);
		}
	});

	it("rewrites an all-zero random draw into a valid id", () => {
		// getRandomValues gets a zeroed buffer; leaving it zero forces the guard.
		vi.spyOn(crypto, "getRandomValues").mockImplementation((buf) => buf);
		const [, traceId, spanId] = newTraceparent().split("-");
		expect(traceId).toBe("01".padEnd(32, "0"));
		expect(spanId).toBe("01".padEnd(16, "0"));
		expect(newTraceparent()).toMatch(TRACEPARENT);
	});

	it("mints a distinct trace id per call", () => {
		const ids = new Set(
			Array.from({ length: 100 }, () => newTraceparent().split("-")[1]),
		);
		expect(ids.size).toBe(100);
	});
});
