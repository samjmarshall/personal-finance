import { describe, expect, it } from "vitest";
import { newTraceparent, traceIdOf } from "~/lib/traceparent";

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe("newTraceparent", () => {
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

	it("mints a distinct trace id per call", () => {
		const ids = new Set(
			Array.from({ length: 100 }, () => traceIdOf(newTraceparent())),
		);
		expect(ids.size).toBe(100);
	});
});

describe("traceIdOf", () => {
	it("returns the 32-hex trace-id segment", () => {
		const traceparent = newTraceparent();
		expect(traceIdOf(traceparent)).toBe(traceparent.split("-")[1]);
	});
});
