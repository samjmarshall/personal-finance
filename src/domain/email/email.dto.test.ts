import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Equal, Expect } from "~/test/type-contracts";
import { inboundEmailEventDto } from "./email.dto";
import type { InboundEmailEvent } from "./email.interface";

// The parsed body is the whole event the service reads, so the two must match
// exactly: a field added to one side only would type-check but never arrive.
type Contracts = [
	Expect<Equal<z.infer<typeof inboundEmailEventDto>, InboundEmailEvent>>,
];

const event = (data: Record<string, unknown>) => ({
	type: "email.received",
	data: { email_id: "e1", from: "sam@example.com", ...data },
});

describe("inboundEmailEventDto", () => {
	// Resend omits or nulls the list on a body-only mail; callers loop without a guard.
	it.each([
		["missing", {}],
		["null", { attachments: null }],
	])("reads %s attachments as an empty list", (_, data) => {
		expect(inboundEmailEventDto.parse(event(data)).data.attachments).toEqual(
			[],
		);
	});

	// An untrusted third-party body: a field Resend adds later must not fail the parse.
	it("accepts fields it does not read", () => {
		const parsed = inboundEmailEventDto.safeParse({
			...event({ attachments: [{ id: "a1", size: 10 }] }),
			created_at: "2026-09-25T00:00:00Z",
		});

		expect(parsed.success).toBe(true);
	});

	it("rejects a body with no sender", () => {
		const { from: _, ...data } = event({}).data;

		expect(
			inboundEmailEventDto.safeParse({ type: "email.received", data }).success,
		).toBe(false);
	});
});

describe("inbound email DTO ↔ interface contract", () => {
	it("keeps the parsed event equal to the InboundEmailEvent interface", () => {
		const aligned: Contracts = [true];
		expect(aligned).toHaveLength(1);
	});
});
