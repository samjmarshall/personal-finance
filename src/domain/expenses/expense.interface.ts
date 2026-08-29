export interface Expense {
	id: number;
	name: string;
	category: string;
	fortnight: number;
	month: number;
	year: number;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date | null;
}
