import { describe, expect, it } from "vitest";
import { expenseCreateDto, expenseUpdateDto } from "./expense.dto";

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
		expect(expenseCreateDto.safeParse({ ...base, fortnight: -1 }).success).toBe(
			false,
		);
	});

	it("defaults fortnight, month and year to 0 when omitted", () => {
		const parsed = expenseCreateDto.parse(base);
		expect(parsed.fortnight).toBe(0);
		expect(parsed.month).toBe(0);
		expect(parsed.year).toBe(0);
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
