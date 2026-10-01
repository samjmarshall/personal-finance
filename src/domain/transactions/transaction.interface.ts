import type { Frequency, Priority } from "~/lib/constants";

export interface Transaction {
	id: number;
	amount: number;
	category: string;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	expenseCategoryId: number | null;
	frequency: Frequency;
	notes: string | null;
	priority: Priority;
	receiptDescription: string | null;
	updatedAt: Date | null;
}

// One Expense's Consumed: linked Spend net of refunds
export interface ExpenseConsumption {
	expenseId: number;
	consumed: number;
}

// list rows leftJoin the linked expense and managed category; null when unlinked
// or the referenced row is gone
export interface TransactionListItem extends Transaction {
	expenseName: string | null;
	expenseCategoryName: string | null;
}

// One page of list rows; total counts every match, not just this page
export interface TransactionListResult {
	items: TransactionListItem[];
	total: number;
}

export interface TransactionSummary {
	totals: {
		spend: number;
		refunds: number;
		net: number;
		count: number;
	};
	byPriority: {
		priority: Priority;
		total: number;
		count: number;
	}[];
	byFrequency: {
		frequency: Frequency;
		total: number;
		count: number;
	}[];
	byMonth: {
		month: string;
		total: number;
	}[];
	topCategories: {
		category: string;
		total: number;
		count: number;
	}[];
}
