export interface Income {
	id: number;
	person: string;
	source: string;
	fortnight: number;
	month: number;
	year: number;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date | null;
}
