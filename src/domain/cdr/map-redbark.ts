import type { SyncedTransaction } from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import type { RedbarkTransaction } from "./cdr.dto";

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
