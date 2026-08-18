import type { Frequency, Priority } from "~/lib/constants";

export interface Transaction {
	id: number;
	amount: number;
	category: string;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	frequency: Frequency;
	notes: string | null;
	priority: Priority;
	receiptDescription: string | null;
	updatedAt: Date | null;
}

// list rows leftJoin the linked expense; null when unlinked or the expense is gone
export interface TransactionListItem extends Transaction {
	expenseName: string | null;
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
