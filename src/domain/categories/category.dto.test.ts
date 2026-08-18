import { describe, expect, it } from "vitest";
import { categoryCreateDto, categoryUpdateDto } from "./category.dto";

const base = { name: "Groceries" };

describe("categoryCreateDto", () => {
	it("accepts a valid category", () => {
		expect(categoryCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects an empty name", () => {
		expect(categoryCreateDto.safeParse({ ...base, name: "" }).success).toBe(
			false,
		);
	});

	it("accepts an omitted description", () => {
		expect(categoryCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects a non-integer sortOrder", () => {
		expect(
			categoryCreateDto.safeParse({ ...base, sortOrder: 1.5 }).success,
		).toBe(false);
	});

	it("defaults sortOrder to 0 when omitted", () => {
		const parsed = categoryCreateDto.parse(base);
		expect(parsed.sortOrder).toBe(0);
	});
});

describe("categoryUpdateDto", () => {
	const baseUpdate = { ...base, id: 1 };

	// update must NOT re-apply create's default: an omitted sortOrder has to parse
	// to undefined so .set() skips it and the stored value survives a partial update.
	it("leaves omitted sortOrder undefined", () => {
		const parsed = categoryUpdateDto.parse(baseUpdate);
		expect(parsed.sortOrder).toBe(undefined);
	});

	it("rejects a non-integer sortOrder", () => {
		expect(
			categoryUpdateDto.safeParse({ ...baseUpdate, sortOrder: 1.5 }).success,
		).toBe(false);
	});

	it("requires an id", () => {
		expect(categoryUpdateDto.safeParse(base).success).toBe(false);
	});
});
