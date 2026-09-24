import { describe, expect, it } from "vitest";
import { trpcHeaders } from "~/trpc/react";

describe("trpcHeaders", () => {
	// adr020: the server span is the root, so the browser must send no parent.
	it("tags the source and sends no traceparent", () => {
		const headers = trpcHeaders();
		expect(headers.get("x-trpc-source")).toBe("nextjs-react");
		expect(headers.has("traceparent")).toBe(false);
	});
});
