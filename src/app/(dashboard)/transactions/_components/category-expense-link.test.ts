import { describe, expect, it } from "vitest";

import {
	expensesInCategory,
	pickCategory,
	pickExpense,
} from "./category-expense-link";

const FOOD = 1;
const HOUSEHOLD = 2;
const WEEKLY_SHOP = { id: 10, categoryId: FOOD };
const TAKEAWAY = { id: 11, categoryId: FOOD };
const CLEANING = { id: 20, categoryId: HOUSEHOLD };
const EXPENSES = [WEEKLY_SHOP, TAKEAWAY, CLEANING];

describe("expensesInCategory", () => {
	it("keeps only the picked Category's expenses", () => {
		expect(expensesInCategory(EXPENSES, FOOD)).toEqual([WEEKLY_SHOP, TAKEAWAY]);
	});

	it("keeps every expense when no Category is picked", () => {
		expect(expensesInCategory(EXPENSES, null)).toEqual(EXPENSES);
	});

	it("is empty for a Category with no expenses", () => {
		expect(expensesInCategory(EXPENSES, 99)).toEqual([]);
	});
});

describe("pickCategory", () => {
	it("keeps a linked Expense in the picked Category", () => {
		const link = { categoryId: FOOD, expenseId: WEEKLY_SHOP.id };
		expect(pickCategory(link, FOOD, EXPENSES)).toEqual(link);
	});

	it("drops a linked Expense from another Category", () => {
		const link = { categoryId: FOOD, expenseId: WEEKLY_SHOP.id };
		expect(pickCategory(link, HOUSEHOLD, EXPENSES)).toEqual({
			categoryId: HOUSEHOLD,
			expenseId: null,
		});
	});

	it("drops a linked Expense when the Category is cleared", () => {
		const link = { categoryId: FOOD, expenseId: WEEKLY_SHOP.id };
		expect(pickCategory(link, null, EXPENSES)).toEqual({
			categoryId: null,
			expenseId: null,
		});
	});

	it("sets the Category when nothing is linked", () => {
		const link = { categoryId: null, expenseId: null };
		expect(pickCategory(link, FOOD, EXPENSES)).toEqual({
			categoryId: FOOD,
			expenseId: null,
		});
	});
});

describe("pickExpense", () => {
	it("takes the Expense's Category when none is picked", () => {
		const link = { categoryId: null, expenseId: null };
		expect(pickExpense(link, CLEANING.id, EXPENSES)).toEqual({
			categoryId: HOUSEHOLD,
			expenseId: CLEANING.id,
		});
	});

	it("keeps the Category when unlinking", () => {
		const link = { categoryId: FOOD, expenseId: WEEKLY_SHOP.id };
		expect(pickExpense(link, null, EXPENSES)).toEqual({
			categoryId: FOOD,
			expenseId: null,
		});
	});
});
