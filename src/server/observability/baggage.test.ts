import { context } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBaggage, setBaggage } from "./baggage";

// AsyncLocalStorageContextManager (registered by NodeTracerProvider) is
// required for context.with to propagate — the default NoopContextManager is
// synchronous only and does not carry the active context through closures.
const provider = new NodeTracerProvider();

beforeAll(() => provider.register());
afterAll(() => provider.shutdown());

describe("setBaggage / readBaggage", () => {
	it("round-trips known keys through context.with", () => {
		const ctx = setBaggage({ "member.id": "m1", "receipt.id": "42" });
		context.with(ctx, () => {
			const result = readBaggage();
			expect(result["member.id"]).toBe("m1");
			expect(result["receipt.id"]).toBe("42");
		});
	});

	it("unknown baggage entries are not returned", () => {
		const ctx = setBaggage({ "member.id": "m1" });
		context.with(ctx, () => {
			const keys = Object.keys(readBaggage());
			expect(keys).not.toContain("some.unknown.key");
			expect(keys).toEqual(["member.id"]);
		});
	});

	it("merges new keys without losing prior ones", () => {
		const ctx1 = setBaggage({ "member.id": "m1" });
		const ctx2 = context.with(ctx1, () => setBaggage({ "receipt.id": "99" }));
		context.with(ctx2, () => {
			const result = readBaggage();
			expect(result["member.id"]).toBe("m1");
			expect(result["receipt.id"]).toBe("99");
		});
	});

	it("returns empty record when no baggage is active", () => {
		expect(readBaggage()).toEqual({});
	});

	it("later setBaggage overwrites an existing key", () => {
		const ctx1 = setBaggage({ "member.id": "old" });
		const ctx2 = context.with(ctx1, () => setBaggage({ "member.id": "new" }));
		context.with(ctx2, () => {
			expect(readBaggage()["member.id"]).toBe("new");
		});
	});
});
