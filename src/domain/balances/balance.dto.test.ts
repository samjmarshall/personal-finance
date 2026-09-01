import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { balanceSetDto } from "./balance.dto";
import type { BalanceSnapshot } from "./balance.interface";

type Contracts = [
	Expect<WritesInto<z.infer<typeof balanceSetDto>, BalanceSnapshot>>,
];

describe("balanceSetDto", () => {
	it("accepts an amount and asOf date", () => {
		expect(
			balanceSetDto.safeParse({ amount: 1000, asOf: new Date() }).success,
		).toBe(true);
	});

	// A household balance can be overdrawn — amount is unsigned-free.
	it("accepts a negative amount", () => {
		expect(
			balanceSetDto.safeParse({ amount: -250.5, asOf: new Date() }).success,
		).toBe(true);
	});

	it("rejects a non-number amount", () => {
		expect(
			balanceSetDto.safeParse({ amount: "1000", asOf: new Date() }).success,
		).toBe(false);
	});

	it("rejects a missing asOf", () => {
		expect(balanceSetDto.safeParse({ amount: 1000 }).success).toBe(false);
	});

	it("rejects a non-date asOf", () => {
		expect(
			balanceSetDto.safeParse({ amount: 1000, asOf: "2026-09-01" }).success,
		).toBe(false);
	});
});

describe("balance DTO ↔ interface contract", () => {
	it("keeps balanceSetDto writable into the BalanceSnapshot interface", () => {
		const aligned: Contracts = [true];
		expect(aligned).toHaveLength(1);
	});
});
