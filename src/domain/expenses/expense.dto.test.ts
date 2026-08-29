import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { expenseCreateDto, expenseUpdateDto } from "./expense.dto";
import type { Expense } from "./expense.interface";

type Contracts = [
	Expect<WritesInto<z.infer<typeof expenseCreateDto>, Expense>>,
	Expect<WritesInto<z.infer<typeof expenseUpdateDto>, Expense>>,
];

const base = { name: "Rent", category: "Housing" };

describe("expenseCreateDto", () => {
	it("accepts a valid expense", () => {
		expect(expenseCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects an empty name", () => {
		expect(expenseCreateDto.safeParse({ ...base, name: "" }).success).toBe(
			false,
		);
	});

	it("rejects an empty category", () => {
		expect(expenseCreateDto.safeParse({ ...base, category: "" }).success).toBe(
			false,
		);
	});

	it("rejects a negative fortnight", () => {
		expect(expenseCreateDto.safeParse({ ...base, year: -1 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, month: -1 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, fortnight: -1 }).success).toBe(
			false,
		);
	});

	// fortnight/month/year are doublePrecision money columns — fractional dollars must pass.
	it("accepts a fractional fortnight", () => {
		expect(expenseCreateDto.safeParse({ ...base, year: 1500.5 }).success).toBe(
			true,
		);
		expect(expenseCreateDto.safeParse({ ...base, month: 1500.5 }).success).toBe(
			true,
		);
		expect(
			expenseCreateDto.safeParse({ ...base, fortnight: 1500.5 }).success,
		).toBe(true);
	});
});

describe("expenseUpdateDto", () => {
	const baseUpdate = { ...base, id: 1 };

	// update must NOT re-apply create's defaults: an omitted numeric has to parse
	// to undefined so .set() skips it and the stored value survives a partial update.
	it("leaves omitted fortnight, month and year undefined", () => {
		const parsed = expenseUpdateDto.parse(baseUpdate);
		expect(parsed.fortnight).toBe(undefined);
		expect(parsed.month).toBe(undefined);
		expect(parsed.year).toBe(undefined);
	});

	it("rejects a negative year", () => {
		expect(
			expenseUpdateDto.safeParse({ ...baseUpdate, year: -1 }).success,
		).toBe(false);
	});

	it("requires an id", () => {
		expect(expenseUpdateDto.safeParse(base).success).toBe(false);
	});
});

describe("expense DTO ↔ interface contract", () => {
	// Annotating with Contracts makes tsc evaluate every pair; the array is
	// contextually typed to the tuple, so it stays a genuine compile-time gate.
	it("keeps create and update DTOs writable into the Expense interface", () => {
		const aligned: Contracts = [true, true];
		expect(aligned).toHaveLength(2);
	});
});
