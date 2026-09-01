// amount signed: + Spend, − Inflow (a tooltip contributor's direction).
export interface CashflowItem {
	label: string;
	amount: number;
}

export interface CashflowBucket {
	key: string; // YYYY-MM-DD of bucket.from — wire-safe, ordering + x-axis
	label: string; // display label formatted server-side ("14 Aug" / "Aug")
	spend: number; // ≥ 0
	inflow: number; // ≥ 0
	balance: number | null; // running balance; null when no snapshot anchor
	isCurrent: boolean; // the today-straddling bucket (today marker)
	items: CashflowItem[]; // tooltip contributors (projected commitments only)
}

export interface CashflowResult {
	buckets: CashflowBucket[];
	hasBalanceAnchor: boolean;
}
