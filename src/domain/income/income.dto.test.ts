import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { incomeCreateDto, incomeUpdateDto } from "./income.dto";
import type { Income } from "./income.interface";

type Contracts = [
	Expect<WritesInto<z.infer<typeof incomeCreateDto>, Income>>,
	Expect<WritesInto<z.infer<typeof incomeUpdateDto>, Income>>,
];

const base = { person: "Sam", source: "Salary" };

describe("incomeCreateDto", () => {
	it("accepts a valid income", () => {
		expect(incomeCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects an empty person", () => {
		expect(incomeCreateDto.safeParse({ ...base, person: "" }).success).toBe(
			false,
		);
	});

	it("rejects an empty source", () => {
		expect(incomeCreateDto.safeParse({ ...base, source: "" }).success).toBe(
			false,
		);
	});

	it("rejects a negative fortnight", () => {
		expect(incomeCreateDto.safeParse({ ...base, fortnight: -1 }).success).toBe(
			false,
		);
	});

	// fortnight/month/year are doublePrecision money columns — fractional dollars must pass.
	it("accepts a fractional fortnight", () => {
		expect(
			incomeCreateDto.safeParse({ ...base, fortnight: 1500.5 }).success,
		).toBe(true);
	});
});

describe("incomeUpdateDto", () => {
	const baseUpdate = { ...base, id: 1 };

	// update must NOT re-apply create's defaults: an omitted numeric has to parse
	// to undefined so .set() skips it and the stored value survives a partial update.
	it("leaves omitted fortnight, month and year undefined", () => {
		const parsed = incomeUpdateDto.parse(baseUpdate);
		expect(parsed.fortnight).toBe(undefined);
		expect(parsed.month).toBe(undefined);
		expect(parsed.year).toBe(undefined);
	});

	it("rejects a negative month", () => {
		expect(
			incomeUpdateDto.safeParse({ ...baseUpdate, month: -1 }).success,
		).toBe(false);
	});

	it("requires an id", () => {
		expect(incomeUpdateDto.safeParse(base).success).toBe(false);
	});
});

describe("income DTO ↔ interface contract", () => {
	// Annotating with Contracts makes tsc evaluate every pair; the array is
	// contextually typed to the tuple, so it stays a genuine compile-time gate.
	it("keeps create and update DTOs writable into the Income interface", () => {
		const aligned: Contracts = [true, true];
		expect(aligned).toHaveLength(2);
	});
});
