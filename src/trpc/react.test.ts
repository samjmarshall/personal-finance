import { describe, expect, it } from "vitest";
import { trpcHeaders } from "~/trpc/react";

describe("trpcHeaders", () => {
	it("sets a valid traceparent alongside x-trpc-source", () => {
		const headers = trpcHeaders();
		expect(headers.get("x-trpc-source")).toBe("nextjs-react");
		expect(headers.get("traceparent")).toMatch(
			/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
		);
	});

	it("mints a fresh traceparent per call", () => {
		expect(trpcHeaders().get("traceparent")).not.toBe(
			trpcHeaders().get("traceparent"),
		);
	});
});
