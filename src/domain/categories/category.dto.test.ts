import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { categoryCreateDto, categoryUpdateDto } from "./category.dto";
import type { Category } from "./category.interface";

type Contracts = [
	Expect<WritesInto<z.infer<typeof categoryCreateDto>, Category>>,
	Expect<WritesInto<z.infer<typeof categoryUpdateDto>, Category>>,
];

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

	it("rejects a negative sortOrder", () => {
		expect(
			categoryCreateDto.safeParse({ ...base, sortOrder: -1 }).success,
		).toBe(false);
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

	it("rejects a negative sortOrder", () => {
		expect(
			categoryUpdateDto.safeParse({ ...baseUpdate, sortOrder: -1 }).success,
		).toBe(false);
	});

	it("requires an id", () => {
		expect(categoryUpdateDto.safeParse(base).success).toBe(false);
	});
});

describe("category DTO ↔ interface contract", () => {
	// Annotating with Contracts makes tsc evaluate every pair; the array is
	// contextually typed to the tuple, so it stays a genuine compile-time gate.
	it("keeps create and update DTOs writable into the Category interface", () => {
		const aligned: Contracts = [true, true];
		expect(aligned).toHaveLength(2);
	});
});
