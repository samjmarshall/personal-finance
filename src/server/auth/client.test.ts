import { describe, expect, it, vi } from "vitest";
import { withTraceparent } from "~/server/auth/client";

describe("withTraceparent", () => {
	it("injects a valid traceparent and forwards to the inner fetch", async () => {
		const response = new Response("ok");
		const inner = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
			Promise.resolve(response),
		);

		const result = await withTraceparent(inner)("https://x.test/api/auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
		});

		expect(result).toBe(response);
		expect(inner).toHaveBeenCalledOnce();
		const [input, init] = inner.mock.calls[0] ?? [];
		expect(input).toBe("https://x.test/api/auth");
		const forwarded = new Headers(init?.headers);
		expect(forwarded.get("content-type")).toBe("application/json");
		expect(forwarded.get("traceparent")).toMatch(
			/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
		);
	});
});
