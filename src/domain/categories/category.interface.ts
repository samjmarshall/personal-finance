export interface Category {
	id: number;
	name: string;
	description: string | null;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date | null;
	expenseCount?: number;
}
