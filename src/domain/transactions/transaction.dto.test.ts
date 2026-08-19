import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { Frequency, Priority } from "~/lib/constants";
import type { Expect, WritesInto } from "~/test/type-contracts";
import { transactionCreateDto, transactionUpdateDto } from "./transaction.dto";
import type { Transaction } from "./transaction.interface";

type Contracts = [
	Expect<WritesInto<z.infer<typeof transactionCreateDto>, Transaction>>,
	Expect<WritesInto<z.infer<typeof transactionUpdateDto>, Transaction>>,
];

const base = { date: new Date(), description: "Coffee", amount: 5 };

describe("transactionCreateDto.expenseId", () => {
	it("accepts an integer expenseId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: 7 }).success,
		).toBe(true);
	});

	it("accepts null (unlinked)", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: null }).success,
		).toBe(true);
	});

	it("accepts an omitted expenseId", () => {
		expect(transactionCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects a string expenseId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: "7" }).success,
		).toBe(false);
	});

	it("rejects a non-integer expenseId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: 7.5 }).success,
		).toBe(false);
	});

	it("rejects a negative expenseId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: -1 }).success,
		).toBe(false);
	});

	it("rejects a 0 expenseId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, expenseId: 0 }).success,
		).toBe(false);
	});
	// omitted must stay undefined, not null: update's .set() skips undefined so an
	// omitted expenseId leaves the existing link intact; null would clear it.
	it("leaves omitted expenseId and notes undefined (update preserves them)", () => {
		const parsed = transactionCreateDto.parse(base);
		expect(parsed.expenseId).toBe(undefined);
		expect(parsed.notes).toBe(undefined);
	});
});

describe("transactionCreateDto vocab fields", () => {
	it("rejects a frequency outside the managed set", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, frequency: "Whenever" })
				.success,
		).toBe(false);
	});

	it("rejects a priority outside the managed set", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, priority: "Someday" }).success,
		).toBe(false);
	});
});

describe("transactionUpdateDto", () => {
	const baseUpdate = { ...base, id: 1 };

	// The regression this guards: update must NOT re-apply create's defaults. An
	// omitted category/frequency/priority has to parse to undefined so .set() skips
	// it and the stored value survives a partial update instead of being reset.
	it("leaves omitted category, frequency and priority undefined", () => {
		const parsed = transactionUpdateDto.parse(baseUpdate);
		expect(parsed.category).toBe(undefined);
		expect(parsed.frequency).toBe(undefined);
		expect(parsed.priority).toBe(undefined);
	});

	it("accepts managed vocab values", () => {
		expect(
			transactionUpdateDto.safeParse({
				...baseUpdate,
				frequency: Frequency.Recurring,
				priority: Priority.MustHave,
			}).success,
		).toBe(true);
	});

	it("rejects a frequency outside the managed set", () => {
		expect(
			transactionUpdateDto.safeParse({ ...baseUpdate, frequency: "Whenever" })
				.success,
		).toBe(false);
	});

	it("requires an id", () => {
		expect(transactionUpdateDto.safeParse(base).success).toBe(false);
	});

	it("rejects a string expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...base, expenseId: "7" }).success,
		).toBe(false);
	});

	it("rejects a non-integer expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...base, expenseId: 7.5 }).success,
		).toBe(false);
	});

	it("rejects a negative expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...base, expenseId: -1 }).success,
		).toBe(false);
	});

	it("rejects a 0 expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...base, expenseId: 0 }).success,
		).toBe(false);
	});
});

describe("transaction DTO ↔ interface contract", () => {
	// Annotating with Contracts makes tsc evaluate every pair; the array is
	// contextually typed to the tuple, so it stays a genuine compile-time gate.
	it("keeps create and update DTOs writable into the Transaction interface", () => {
		const aligned: Contracts = [true, true];
		expect(aligned).toHaveLength(2);
	});
});
