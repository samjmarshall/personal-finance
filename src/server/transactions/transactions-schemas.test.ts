import { describe, expect, it } from "vitest";
import { transactionInput } from "~/server/transactions/transactions-schemas";

const base = { date: new Date(), description: "Coffee", amount: 5 };

describe("transactionInput.expenseId", () => {
	it("accepts an integer expenseId", () => {
		expect(transactionInput.safeParse({ ...base, expenseId: 7 }).success).toBe(
			true,
		);
	});

	it("accepts null (unlinked)", () => {
		expect(
			transactionInput.safeParse({ ...base, expenseId: null }).success,
		).toBe(true);
	});

	it("accepts an omitted expenseId", () => {
		expect(transactionInput.safeParse(base).success).toBe(true);
	});

	it("rejects a string expenseId", () => {
		expect(
			transactionInput.safeParse({ ...base, expenseId: "7" }).success,
		).toBe(false);
	});

	it("rejects a non-integer expenseId", () => {
		expect(
			transactionInput.safeParse({ ...base, expenseId: 7.5 }).success,
		).toBe(false);
	});
});
