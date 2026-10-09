import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Expect, WritesInto } from "~/test/type-contracts";
import {
	categoryCreateDto,
	categoryReorderDto,
	categoryUpdateDto,
} from "./category.dto";
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

	it("rejects a whitespace-only name", () => {
		expect(categoryCreateDto.safeParse({ ...base, name: "   " }).success).toBe(
			false,
		);
	});

	it("accepts an omitted description", () => {
		expect(categoryCreateDto.safeParse(base).success).toBe(true);
	});
});

describe("categoryUpdateDto", () => {
	it("requires an id", () => {
		expect(categoryUpdateDto.safeParse(base).success).toBe(false);
	});
});

describe("categoryReorderDto", () => {
	it("accepts an ordered list of ids", () => {
		expect(categoryReorderDto.safeParse({ ids: [3, 1, 2] }).success).toBe(true);
	});

	it("rejects an empty list", () => {
		expect(categoryReorderDto.safeParse({ ids: [] }).success).toBe(false);
	});

	it("rejects a non-integer id", () => {
		expect(categoryReorderDto.safeParse({ ids: [1.5] }).success).toBe(false);
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
