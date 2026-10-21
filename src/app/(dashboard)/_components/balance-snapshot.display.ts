import { BalanceSource } from "~/lib/constants";

const LABELS: Record<BalanceSource, string> = {
	[BalanceSource.Cdr]: "Synced from bank",
	[BalanceSource.Manual]: "Entered by you",
};

// Who set the balance, so a member knows whether the next sync will replace it.
export function balanceSourceLabel(source: BalanceSource): string {
	return LABELS[source];
}
