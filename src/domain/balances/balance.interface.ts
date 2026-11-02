import type { BalanceSource } from "~/lib/constants";

export interface BalanceSnapshot {
	id: number;
	amount: number;
	asOf: Date;
	createdAt: Date;
	source: BalanceSource;
}
