import type { CdrSyncState } from "~/domain/cdr";
import { formatCurrency } from "~/lib/utils";

type Counted = Pick<CdrSyncState, "balance" | "inBalance">;
type Grouped = Counted & Pick<CdrSyncState, "institutionName">;

// A row saved before discovery stored the bank's name.
const UNNAMED_BANK = "Other accounts";

export interface BankGroup<T> {
	bank: string;
	accounts: T[];
	counted: number;
}

/** Banks A–Z, unnamed last. Rows by balance high → low, unread last. */
export function groupByBank<T extends Grouped>(accounts: T[]): BankGroup<T>[] {
	const byBank = new Map<string | null, T[]>();

	for (const account of accounts) {
		byBank.set(account.institutionName, [
			...(byBank.get(account.institutionName) ?? []),
			account,
		]);
	}

	return [...byBank]
		.sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
		.map(([bank, rows]) => ({
			bank: bank ?? UNNAMED_BANK,
			// By balance, not by switch, so a row never jumps away mid-flip.
			accounts: [...rows].sort(byBalance),
			counted: rows.filter((row) => row.inBalance).length,
		}));
}

// High → low, unread last.
function byBalance(x: Counted, y: Counted): number {
	if (x.balance === null || y.balance === null) {
		return Number(x.balance === null) - Number(y.balance === null);
	}

	return y.balance - x.balance;
}

/** Σ counted balances. Null while any account is undecided or a counted one is unread. */
export function cashTotal(accounts: Counted[]): number | null {
	if (accounts.some((a) => a.inBalance === null)) return null;

	let total = 0;

	for (const { balance, inBalance } of accounts) {
		if (!inBalance) continue;
		if (balance === null) return null;

		total += balance;
	}

	return total;
}

/** The line under Total: what it counts, or what it waits on. */
export function totalNote(accounts: Counted[]): string {
	const undecided = accounts.filter((a) => a.inBalance === null).length;

	if (undecided) {
		return `Waiting on ${undecided} new account${undecided === 1 ? "" : "s"}`;
	}

	if (cashTotal(accounts) === null) return "Waiting on the next bank sync";

	const counted = accounts.filter((a) => a.inBalance).length;

	return `${counted} of ${accounts.length} accounts counted`;
}

/** Points at undecided rows, which sort by balance and can sit below the fold. Null when none. */
export function newAccountsNote(accounts: Counted[]): string | null {
	const undecided = accounts.filter((a) => a.inBalance === null).length;

	if (!undecided) return null;

	return undecided === 1
		? "1 new account needs a choice. Find it marked New below."
		: `${undecided} new accounts need a choice. Find them marked New below.`;
}

/** "xxxx8273" → "ending 8273", so a screen reader skips the x's. Unchanged with no trailing digits. */
export function spokenAccountNumber(masked: string): string {
	const last = /\d+$/.exec(masked)?.[0];

	return last ? `ending ${last}` : masked;
}

export function formatBalance(amount: number): string {
	return `${amount < 0 ? "-" : ""}${formatCurrency(Math.abs(amount))}`;
}
