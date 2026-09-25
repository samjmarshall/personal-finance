import { describe, expect, it, vi } from "vitest";

const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after }));
vi.mock("./posthog", () => ({ flushPostHog: vi.fn() }));
vi.mock("./otel-registry", () => ({ getRegisteredProcessors: () => null }));

const { flushAfterResponse, flushTelemetry } = await import("./flush");

describe("flushAfterResponse", () => {
	// Run inline, the flush would hold the response open for up to 5 s.
	it("hands the flush to after(), not run inline", () => {
		flushAfterResponse();

		expect(after).toHaveBeenCalledWith(flushTelemetry);
	});
});
