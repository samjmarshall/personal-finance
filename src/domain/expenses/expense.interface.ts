export interface Expense {
	id: number;
	name: string;
	category: string;
	fortnight: number;
	month: number;
	year: number;
	createdAt: Date;
	updatedAt: Date | null;
}
