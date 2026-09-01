import { describe, expect, it } from "vitest";
import type { Equal, Expect } from "~/test/type-contracts";

import { buildOutboxEvent, type EventName, type EventPayload } from "./events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("buildOutboxEvent", () => {
	it("mints a descriptor carrying a uuid id, the name, and the parsed payload", () => {
		const event = buildOutboxEvent("receipt/uploaded", { receiptId: "r1" });

		expect(event.name).toBe("receipt/uploaded");
		expect(event.data).toEqual({ receiptId: "r1" });
		expect(event.id).toMatch(UUID);
	});

	it("mints a distinct id per call (each is its own idempotency key)", () => {
		const a = buildOutboxEvent("receipt/uploaded", { receiptId: "r1" });
		const b = buildOutboxEvent("receipt/uploaded", { receiptId: "r1" });

		expect(a.id).not.toBe(b.id);
	});

	it("throws when the payload fails the registry schema", () => {
		expect(() =>
			// @ts-expect-error — receiptId must be a string
			buildOutboxEvent("receipt/uploaded", { receiptId: 1 }),
		).toThrow();
	});
});

// Compile-time contracts: erased at runtime, checked by `make check`.
type _NameIsRegistryKeys = Expect<
	Equal<
		EventName,
		"receipt/uploaded" | "receipt/email.received" | "receipt/retry"
	>
>;
type _PayloadShape = Expect<
	Equal<EventPayload<"receipt/uploaded">, { receiptId: string }>
>;
