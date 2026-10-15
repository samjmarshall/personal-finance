import type { SyncedTransaction } from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import type { RedbarkTransaction } from "./cdr.dto";

/**
 * One settled RedBark row → the app's Spend-positive glossary (adr017 facet 4).
 * Throws on a missing amount, a non-AUD currency, or a `direction` that
 * disagrees with the number's sign.
 */
export function mapRedbarkTransaction(
	row: RedbarkTransaction,
	accountName: string,
): SyncedTransaction {
	if (!row.amount) throw new Error(`redbark ${row.id}: no amount`);
	const { amount: minor, currency } = row.amount;
	if (currency.toLowerCase() !== "aud")
		throw new Error(`redbark ${row.id}: currency ${currency} is not AUD`);

	// CDR signs from the account holder's side (money out < 0); Spend is positive here.
	const spend = minor === 0 ? 0 : -minor / 100;
	const disagrees =
		(row.direction === "debit" && spend < 0) ||
		(row.direction === "credit" && spend > 0);
	if (disagrees)
		throw new Error(
			`redbark ${row.id}: direction ${row.direction} disagrees with amount ${minor}`,
		);

	return {
		provenance: Provenance.Cdr,
		externalId: row.id,
		accountName,
		amount: spend,
		// A bare calendar day with no member zone on a cron; UTC midnight keeps
		// the day for any zone east of UTC.
		date: new Date(`${row.date}T00:00:00.000Z`),
		description: row.description,
	};
}
