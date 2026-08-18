export interface Transaction {
	id: number;
	amount: number;
	category: string;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	frequency: string;
	notes: string | null;
	priority: string;
	receiptDescription: string | null;
	updatedAt: Date | null;
}

export interface TransactionSummary {
	totals: {
		spend: number;
		refunds: number;
		net: number;
		count: number;
	};
	byPriority: {
		priority: string;
		total: number;
		count: number;
	}[];
	byFrequency: {
		frequency: string;
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
