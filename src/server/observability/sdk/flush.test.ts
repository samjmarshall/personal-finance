import { describe, expect, it, vi } from "vitest";

const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after }));
vi.mock("~/server/observability/errors/posthog", () => ({
	flushPostHog: vi.fn(),
}));
vi.mock("./otel-registry", () => ({ getRegisteredProcessors: () => null }));

const { flushAfterResponse, flushTelemetry, withFlush } = await import(
	"./flush"
);

describe("withFlush", () => {
	// Scheduled before the handler runs, so a handler that throws still drains.
	it("schedules the flush, then returns the handler's result", () => {
		after.mockClear();
		const handler = withFlush((a: number, b: number) => a + b);

		expect(after).not.toHaveBeenCalled();
		expect(handler(2, 3)).toBe(5);
		expect(after).toHaveBeenCalledWith(flushTelemetry);
	});

	it("schedules the flush even when the handler throws", () => {
		after.mockClear();
		const handler = withFlush(() => {
			throw new Error("boom");
		});

		expect(handler).toThrow("boom");
		expect(after).toHaveBeenCalledTimes(1);
	});
});

describe("flushAfterResponse", () => {
	// Run inline, the flush would hold the response open for up to 5 s.
	it("hands the flush to after(), not run inline", () => {
		flushAfterResponse();

		expect(after).toHaveBeenCalledWith(flushTelemetry);
	});
});
