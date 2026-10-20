import type { Frequency, Priority, Provenance } from "~/lib/constants";

export interface Transaction {
	id: number;
	accountName: string | null;
	amount: number;
	categoryId: number | null;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	externalId: string | null;
	frequency: Frequency;
	group: string;
	notes: string | null;
	priority: Priority;
	provenance: Provenance;
	receiptDescription: string | null;
	updatedAt: Date | null;
}

// A row a bank sync owns, found again by provider + its bank id. Holds no member
// edits, so a re-sync can't overwrite them.
export interface SyncedTransaction {
	// Never manual: the edit guard trusts a manual row to be member-owned.
	provenance: Exclude<Provenance, Provenance.Manual>;
	externalId: string;
	accountName: string;
	amount: number;
	date: Date;
	description: string;
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
