import { describe, expect, it } from "vitest";

import { posthogTraceUrl } from "./posthog-trace-url";

const uiHost = "https://us.posthog.com";

describe("posthogTraceUrl", () => {
	it("builds the trace-viewer deep-link, passing the id verbatim", () => {
		expect(
			posthogTraceUrl({ uiHost, projectId: "42", traceId: "abc123def456" }),
		).toBe("https://us.posthog.com/project/42/tracing?trace=abc123def456");
	});

	it("returns null when the project id is missing", () => {
		expect(
			posthogTraceUrl({ uiHost, projectId: undefined, traceId: "abc" }),
		).toBeNull();
	});

	it("returns null when the trace id is null", () => {
		expect(
			posthogTraceUrl({ uiHost, projectId: "42", traceId: null }),
		).toBeNull();
	});
});
