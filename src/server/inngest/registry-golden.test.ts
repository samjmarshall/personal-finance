import { describe, expect, it } from "vitest";

import { EVENT_REGISTRY } from "./events";

// Tripwire for the FROZEN wire strings (adr002 clause 7; server-architecture rule).
// These keys are Inngest event names — byte-stable across the wire. A change here
// must be deliberate + recorded in an ADR consequence note, never a drive-by.
describe("event registry golden", () => {
	it("pins the frozen event names", () => {
		expect(Object.keys(EVENT_REGISTRY).sort()).toEqual([
			"receipt/email.received",
			"receipt/retry",
			"receipt/uploaded",
		]);
	});
});
