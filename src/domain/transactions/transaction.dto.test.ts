import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { Frequency, Priority } from "~/lib/constants";
import type { Expect, WritesInto } from "~/test/type-contracts";
import {
	linkExpenseDto,
	transactionCreateDto,
	transactionUpdateDto,
	unplannedDto,
} from "./transaction.dto";
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

describe("transactionCreateDto.categoryId", () => {
	it("accepts a positive integer categoryId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: 3 }).success,
		).toBe(true);
	});

	it("accepts null (uncategorised)", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: null }).success,
		).toBe(true);
	});

	it("accepts an omitted categoryId", () => {
		expect(transactionCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects a string categoryId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: "3" }).success,
		).toBe(false);
	});

	it("rejects a non-integer categoryId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: 3.5 }).success,
		).toBe(false);
	});

	it("rejects a negative categoryId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: -1 }).success,
		).toBe(false);
	});

	it("rejects a 0 categoryId", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, categoryId: 0 }).success,
		).toBe(false);
	});
});

describe("transactionCreateDto.group", () => {
	it("accepts a non-empty group", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, group: "Food" }).success,
		).toBe(true);
	});

	it("accepts an omitted group (DB default fills it)", () => {
		expect(transactionCreateDto.safeParse(base).success).toBe(true);
	});

	it("rejects an empty group", () => {
		expect(transactionCreateDto.safeParse({ ...base, group: "" }).success).toBe(
			false,
		);
	});

	it("rejects a whitespace-only group", () => {
		expect(
			transactionCreateDto.safeParse({ ...base, group: "   " }).success,
		).toBe(false);
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
	// omitted group/frequency/priority has to parse to undefined so .set() skips
	// it and the stored value survives a partial update instead of being reset.
	it("leaves omitted group, frequency and priority undefined", () => {
		const parsed = transactionUpdateDto.parse(baseUpdate);
		expect(parsed.group).toBe(undefined);
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
			transactionUpdateDto.safeParse({ ...baseUpdate, expenseId: "7" }).success,
		).toBe(false);
	});

	it("rejects a non-integer expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...baseUpdate, expenseId: 7.5 }).success,
		).toBe(false);
	});

	it("rejects a negative expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...baseUpdate, expenseId: -1 }).success,
		).toBe(false);
	});

	it("rejects a 0 expenseId", () => {
		expect(
			transactionUpdateDto.safeParse({ ...baseUpdate, expenseId: 0 }).success,
		).toBe(false);
	});
});

describe("unplannedDto", () => {
	it("accepts a from/to date window", () => {
		expect(
			unplannedDto.safeParse({
				from: new Date(2026, 7, 1),
				to: new Date(2026, 8, 1),
			}).success,
		).toBe(true);
	});

	it("accepts an equal from/to (empty window)", () => {
		const day = new Date(2026, 7, 1);
		expect(unplannedDto.safeParse({ from: day, to: day }).success).toBe(true);
	});

	it("rejects an inverted window (from after to)", () => {
		expect(
			unplannedDto.safeParse({
				from: new Date(2026, 8, 1),
				to: new Date(2026, 7, 1),
			}).success,
		).toBe(false);
	});

	it("rejects a missing bound", () => {
		expect(unplannedDto.safeParse({ from: new Date() }).success).toBe(false);
	});

	it("rejects a non-date bound", () => {
		expect(
			unplannedDto.safeParse({ from: "2026-08-01", to: new Date() }).success,
		).toBe(false);
	});
});

describe("linkExpenseDto", () => {
	it("accepts an integer id linking to an expense", () => {
		expect(linkExpenseDto.safeParse({ id: 1, expenseId: 7 }).success).toBe(
			true,
		);
	});

	it("accepts a null expenseId (clearing the link)", () => {
		expect(linkExpenseDto.safeParse({ id: 1, expenseId: null }).success).toBe(
			true,
		);
	});

	it("rejects a float id", () => {
		expect(linkExpenseDto.safeParse({ id: 1.5, expenseId: 7 }).success).toBe(
			false,
		);
	});

	it("rejects a string id", () => {
		expect(linkExpenseDto.safeParse({ id: "1", expenseId: 7 }).success).toBe(
			false,
		);
	});

	it("rejects a zero or negative id", () => {
		expect(linkExpenseDto.safeParse({ id: 0, expenseId: 7 }).success).toBe(
			false,
		);
		expect(linkExpenseDto.safeParse({ id: -3, expenseId: 7 }).success).toBe(
			false,
		);
	});

	it("rejects a float expenseId", () => {
		expect(linkExpenseDto.safeParse({ id: 1, expenseId: 7.5 }).success).toBe(
			false,
		);
	});

	it("rejects a zero or negative expenseId", () => {
		expect(linkExpenseDto.safeParse({ id: 1, expenseId: 0 }).success).toBe(
			false,
		);
		expect(linkExpenseDto.safeParse({ id: 1, expenseId: -3 }).success).toBe(
			false,
		);
	});

	// expenseId is required, not optional: clearing must pass null explicitly so an
	// omitted value can't silently no-op the link.
	it("rejects a missing expenseId", () => {
		expect(linkExpenseDto.safeParse({ id: 1 }).success).toBe(false);
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
