import { describe, expect, it } from "vitest";
import { transactionCreateDto } from "./transaction.dto";

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
