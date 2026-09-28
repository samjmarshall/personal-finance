import { describe, expect, it } from "vitest";

import { posthogTraceUrl } from "./posthog-trace-url";

const uiHost = "https://us.posthog.com";

describe("posthogTraceUrl", () => {
	it("builds the trace-viewer deep-link, passing the id verbatim", () => {
		expect(posthogTraceUrl({ uiHost, projectId: "42" }, "abc123def456")).toBe(
			"https://us.posthog.com/project/42/tracing?trace=abc123def456",
		);
	});

	it("does not double the slash when the host has a trailing one", () => {
		expect(
			posthogTraceUrl(
				{ uiHost: "https://us.posthog.com/", projectId: "42" },
				"abc",
			),
		).toBe("https://us.posthog.com/project/42/tracing?trace=abc");
	});

	it("percent-encodes ids with url-special characters", () => {
		expect(posthogTraceUrl({ uiHost, projectId: "a/b" }, "x&y")).toBe(
			"https://us.posthog.com/project/a%2Fb/tracing?trace=x%26y",
		);
	});

	it("returns null when the project id is missing", () => {
		expect(posthogTraceUrl({ uiHost, projectId: undefined }, "abc")).toBeNull();
	});

	it("returns null when the trace id is null", () => {
		expect(posthogTraceUrl({ uiHost, projectId: "42" }, null)).toBeNull();
	});
});
