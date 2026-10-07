import type { CommitmentKind } from "~/lib/constants";

export interface Expense {
	id: number;
	name: string;
	categoryId: number;
	kind: CommitmentKind;
	fortnight: number;
	month: number;
	year: number;
	amount: number | null;
	expectedDate: Date | null;
	dueDay: number | null;
	dueMonth: number | null;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date | null;
}
