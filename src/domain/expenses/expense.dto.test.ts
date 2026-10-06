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

	it("rejects a whitespace-only name or category", () => {
		expect(expenseCreateDto.safeParse({ ...base, name: "  " }).success).toBe(
			false,
		);
		expect(
			expenseCreateDto.safeParse({ ...base, category: "  " }).success,
		).toBe(false);
	});

	it("trims the name and category", () => {
		expect(
			expenseCreateDto.parse({ name: " Rent ", category: " Housing " }),
		).toMatchObject(base);
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

describe("expenseCreateDto kind + one-time fields", () => {
	it("accepts recurring, one-time, or an omitted kind", () => {
		expect(
			expenseCreateDto.safeParse({ ...base, kind: "recurring" }).success,
		).toBe(true);
		expect(
			expenseCreateDto.safeParse({
				...base,
				kind: "one-time",
				amount: 100,
				expectedDate: new Date(),
			}).success,
		).toBe(true);
		expect(expenseCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects an unknown kind", () => {
		expect(
			expenseCreateDto.safeParse({ ...base, kind: "weekly" }).success,
		).toBe(false);
	});

	it("accepts null or omitted amount and expectedDate", () => {
		expect(
			expenseCreateDto.safeParse({ ...base, amount: null, expectedDate: null })
				.success,
		).toBe(true);
		expect(
			expenseCreateDto.safeParse({
				...base,
				amount: 42,
				expectedDate: new Date(),
			}).success,
		).toBe(true);
	});

	it("bounds dueDay to 1–31 and dueMonth to 1–12", () => {
		expect(expenseCreateDto.safeParse({ ...base, dueDay: 0 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, dueDay: 32 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, dueDay: 31 }).success).toBe(
			true,
		);
		expect(expenseCreateDto.safeParse({ ...base, dueMonth: 0 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, dueMonth: 13 }).success).toBe(
			false,
		);
		expect(expenseCreateDto.safeParse({ ...base, dueMonth: 12 }).success).toBe(
			true,
		);
	});

	// adr011: the one-time invariant lives in Zod, not a DB CHECK.
	it("requires both amount and expectedDate when kind is one-time", () => {
		expect(
			expenseCreateDto.safeParse({
				...base,
				kind: "one-time",
				expectedDate: new Date(),
			}).success,
		).toBe(false);
		expect(
			expenseCreateDto.safeParse({ ...base, kind: "one-time", amount: 100 })
				.success,
		).toBe(false);
		expect(
			expenseCreateDto.safeParse({ ...base, kind: "one-time" }).success,
		).toBe(false);
		expect(
			expenseCreateDto.safeParse({
				...base,
				kind: "one-time",
				amount: 100,
				expectedDate: new Date(),
			}).success,
		).toBe(true);
	});

	it("does not require amount or expectedDate for a recurring kind", () => {
		expect(
			expenseCreateDto.safeParse({ ...base, kind: "recurring" }).success,
		).toBe(true);
	});
});

describe("expenseUpdateDto", () => {
	const baseUpdate = { ...base, id: 1, kind: "recurring" as const };

	// kind is required on update so a partial body can't omit it and slip a null
	// figure past the one-time invariant (adr011).
	it("requires kind and can't be bypassed by omitting it", () => {
		expect(expenseUpdateDto.safeParse({ ...base, id: 1 }).success).toBe(false);
		expect(
			expenseUpdateDto.safeParse({ ...base, id: 1, amount: null }).success,
		).toBe(false);
	});

	// The invariant guards update too: a row flipped to one-time still needs both.
	it("requires both amount and expectedDate when updating to one-time", () => {
		expect(
			expenseUpdateDto.safeParse({ ...baseUpdate, kind: "one-time" }).success,
		).toBe(false);
		expect(
			expenseUpdateDto.safeParse({
				...baseUpdate,
				kind: "one-time",
				amount: 100,
				expectedDate: new Date(),
			}).success,
		).toBe(true);
	});

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
