import { BalanceSource } from "~/lib/constants";

const LABELS: Record<BalanceSource, string> = {
	[BalanceSource.Cdr]: "Synced from bank",
	[BalanceSource.Manual]: "Entered by you",
};

// Whose number the projection rests on: the bank's sync or the member's own.
export function balanceSourceLabel(source: BalanceSource): string {
	return LABELS[source];
}
