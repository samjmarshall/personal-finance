import type {
	Frequency,
	PossibleDuplicateStatus,
	Priority,
	Provenance,
} from "~/lib/constants";

export interface Transaction {
	id: number;
	accountName: string | null;
	amount: number;
	categoryId: number | null;
	createdAt: Date;
	date: Date;
	description: string;
	expenseId: number | null;
	externalAccountId: string | null;
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
	// The bank's account id, so a re-linked account's old rows can be told apart.
	externalAccountId: string;
	accountName: string;
	amount: number;
	date: Date;
	description: string;
}

// A bank row held back because it looks like a household row but isn't exact.
// The only copy of that bank row until a member answers.
export interface PossibleDuplicate {
	id: number;
	accountName: string;
	amount: number;
	createdAt: Date;
	date: Date;
	description: string;
	externalAccountId: string;
	externalId: string;
	provenance: SyncedTransaction["provenance"];
	status: PossibleDuplicateStatus;
	transactionId: number;
	updatedAt: Date | null;
}

// One pending question: the bank's row beside the member's.
export interface PossibleDuplicateReview {
	id: number;
	bank: Pick<
		PossibleDuplicate,
		"date" | "amount" | "description" | "accountName"
	>;
	mine: Pick<
		Transaction,
		"id" | "date" | "amount" | "description" | "accountName" | "provenance"
	>;
}

// What one reconcile did. `known` counts refreshed rows and reviews, and bank
// rows a member already kept theirs over. Flagged is net pending reviews: a
// released review becomes an added row, so it can go below 0.
export interface ReconcileCounts {
	added: number;
	adopted: number;
	flagged: number;
	known: number;
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
