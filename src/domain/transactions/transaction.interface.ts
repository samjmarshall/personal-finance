import type { Frequency, Priority } from "~/lib/constants";

export interface Transaction {
	id: number;
	amount: number;
	categoryId: number | null;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	frequency: Frequency;
	group: string;
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

// Names of the linked Expense and of the Category the row shows (the Expense's
// if linked). Null when there is none or it's gone.
export interface TransactionListItem extends Transaction {
	expenseName: string | null;
	categoryName: string | null;
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
	topGroups: {
		group: string;
		total: number;
		count: number;
	}[];
}
