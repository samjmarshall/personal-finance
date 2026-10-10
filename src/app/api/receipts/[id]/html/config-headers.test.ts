import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import config from "../../../../../../next.config";

// Config headers beat the ones a route sets, and the last match wins, so check
// what the browser really gets once every matching entry applies.
async function configHeadersFor(pathname: string) {
	const merged: Record<string, string> = {};
	for (const entry of (await config.headers?.()) ?? []) {
		if (!getPathMatch(entry.source)(pathname)) continue;
		for (const { key, value } of entry.headers) {
			merged[key.toLowerCase()] = value;
		}
	}
	return merged;
}

describe("next.config headers on the e-receipt body (adr019)", () => {
	it("sends no referrer", async () => {
		const headers = await configHeadersFor("/api/receipts/7/html");

		expect(headers["referrer-policy"]).toBe("no-referrer");
	});

	it("leaves the route's own CSP in charge", async () => {
		const headers = await configHeadersFor("/api/receipts/7/html");

		expect(headers).not.toHaveProperty("content-security-policy");
	});

	it("keeps the app-wide referrer policy on the image route", async () => {
		const headers = await configHeadersFor("/api/receipts/7/image");

		expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
	});
});
