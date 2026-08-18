import { describe, expect, it } from "vitest";
import { incomeCreateDto, incomeUpdateDto } from "./income.dto";

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

	it("defaults fortnight, month and year to 0 when omitted", () => {
		const parsed = incomeCreateDto.parse(base);
		expect(parsed.fortnight).toBe(0);
		expect(parsed.month).toBe(0);
		expect(parsed.year).toBe(0);
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
