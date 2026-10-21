import type { BalanceSetInput } from "~/domain/balances";
import type { SyncedTransaction } from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import type { RedbarkBalance, RedbarkTransaction } from "./cdr.dto";

/**
 * One settled RedBark row → the app's Spend-positive glossary (adr017 facet 4).
 * Throws on a pending row, a missing amount, a non-AUD currency, or a
 * `direction` that disagrees with the number's sign.
 */
export function mapRedbarkTransaction(
	row: RedbarkTransaction,
	accountName: string,
): SyncedTransaction {
	// A pending row gets a new id once it settles, so ingesting it would count the Spend twice.
	if (row.status && row.status !== "posted")
		throw new Error(`redbark ${row.id}: status ${row.status} is not settled`);
	if (!row.amount) throw new Error(`redbark ${row.id}: no amount`);
	const { amount: minor, currency } = row.amount;
	if (currency.toLowerCase() !== "aud")
		throw new Error(`redbark ${row.id}: currency ${currency} is not AUD`);

	// CDR signs from the account holder's side (money out < 0); Spend is positive here.
	const amount = minor === 0 ? 0 : -minor / 100;
	const disagrees =
		(row.direction === "debit" && amount < 0) ||
		(row.direction === "credit" && amount > 0);
	if (disagrees)
		throw new Error(
			`redbark ${row.id}: direction ${row.direction} disagrees with amount ${minor}`,
		);

	return {
		provenance: Provenance.Cdr,
		externalId: row.id,
		accountName,
		amount,
		// Bank date has no time or zone. UTC midnight shows the same day in Australia.
		date: new Date(`${row.date}T00:00:00.000Z`),
		description: row.description,
	};
}

// A card is paid in full each month, so its debt is money already spent; a loan's isn't.
const IN_BALANCE_BY_TYPE = new Map([
	["transaction", true],
	["savings", true],
	["credit-card", true],
	["loan", false],
]);

/** Whether an account of this RedBark `type` counts toward the balance anchor; null when unknown. */
export function inBalanceByDefault(type: string): boolean | null {
	return IN_BALANCE_BY_TYPE.get(type) ?? null;
}

/**
 * The household balance from each counted account's settled `current` (adr017
 * facet 6). Null unless every balance is fresh and complete. Throws on non-AUD.
 */
export function anchorFromBalances(
	balances: RedbarkBalance[],
): BalanceSetInput | null {
	if (balances.length === 0) return null;
	let minor = 0;
	let asOf: Date | null = null;
	for (const { account, current, freshness, observed_at } of balances) {
		if (freshness !== "fresh" || !current || !observed_at) return null;
		if (current.currency.toLowerCase() !== "aud")
			throw new Error(
				`redbark ${account}: balance currency ${current.currency} is not AUD`,
			);
		minor += current.amount;
		const observed = new Date(observed_at);
		if (!asOf || observed < asOf) asOf = observed;
	}
	return asOf ? { amount: minor / 100, asOf } : null;
}

/** One account's balance in dollars for the list. Null when unread or not AUD, so the saved one stays. */
export function latestBalance(balance: RedbarkBalance): BalanceSetInput | null {
	const { current, observed_at } = balance;
	if (!current || !observed_at || current.currency.toLowerCase() !== "aud")
		return null;
	return { amount: current.amount / 100, asOf: new Date(observed_at) };
}
