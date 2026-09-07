import { fromDateInput, startOfDayInZone } from "~/lib/utils";

// A till total and the bank's settled amount agree to the cent far more often than
// not; the 2% band only has to absorb a tip/rounding line, not a different purchase.
const AMOUNT_TOLERANCE = 0.02;
// Card settlement lags the purchase by a day or two, and weekends stretch it.
const DATE_WINDOW_DAYS = 4;

const MS_PER_DAY = 86_400_000;

/**
 * Days either side of the receipt date a candidate *scan* must cover. One wider
 * than the matcher's own window so a timestamp/timezone edge can't cut a row the
 * exact filter would have kept — the scan is deliberately coarse.
 */
export const MATCH_SCAN_DAYS = DATE_WINDOW_DAYS + 1;

/** A transaction offered to the matcher, with whether a receipt already claims it. */
export interface MatchTransaction {
	id: number;
	description: string;
	amount: number;
	date: Date;
	hasReceipt: boolean;
}

export interface MatchCandidate extends MatchTransaction {
	/** Dollars between the transaction and the receipt total, always positive. */
	amountDelta: number;
	/** Whole days from the receipt date; negative when the transaction is earlier. */
	dayDelta: number;
}

// Whole days between two local calendar days. Round (not floor) so a DST shift —
// which makes a "day" 23 or 25 hours — can't bleed into an off-by-one.
function daysBetween(from: Date, to: Date): number {
	return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Half-open `[from, to)` instant range to pull before ranking, or null when the
 * receipt has no date to scan around. MATCH_SCAN_DAYS either side — one day wider
 * than the ±4 the ranking itself keeps, which is the slack that absorbs a viewer
 * zone up to ~24h off the server's.
 */
export function matchScanWindow(
	receiptDate: string,
): { from: Date; to: Date } | null {
	const receiptDay = fromDateInput(receiptDate);
	if (!receiptDay) return null;
	const from = new Date(receiptDay);
	from.setDate(from.getDate() - MATCH_SCAN_DAYS);
	const to = new Date(receiptDay);
	// Half-open upper bound, so the last in-window day counts whole.
	to.setDate(to.getDate() + MATCH_SCAN_DAYS + 1);
	return { from, to };
}

/**
 * Rank the transactions a receipt could belong to, closest amount first then
 * closest date. Never auto-links (adr010 / design decision 7) — a member confirms.
 *
 * Keeps rows within ±2% of the total *and* ±4 days of the receipt date, both
 * bounds inclusive. Transactions another receipt already claims are dropped, so a
 * confirmed match disappears from every other receipt's list on the next read.
 * A receipt still missing its total or date yields nothing rather than guessing.
 *
 * `timeZone` is the *viewer's* IANA zone, not the server's.
 */
export function matchCandidates(
	receipt: { total: number | null; receiptDate: string | null },
	transactions: MatchTransaction[],
	timeZone: string,
): MatchCandidate[] {
	const { total, receiptDate } = receipt;
	if (total === null || receiptDate === null) return [];
	const receiptDay = fromDateInput(receiptDate);
	if (!receiptDay) return [];

	const maxAmountDelta = Math.abs(total) * AMOUNT_TOLERANCE;

	return transactions
		.filter((t) => !t.hasReceipt)
		.map((t) => ({
			...t,
			amountDelta: Math.abs(t.amount - total),
			// receiptDate is a bare calendar day; the transaction is an instant, so which
			// day it counts as depends on the zone you resolve it in. Resolve in the
			// viewer's — the server's is UTC on Vercel, which would shift an AU evening
			// spend a day earlier and skew both this label and the ±4-day window.
			dayDelta: daysBetween(receiptDay, startOfDayInZone(t.date, timeZone)),
		}))
		.filter(
			(c) =>
				c.amountDelta <= maxAmountDelta &&
				Math.abs(c.dayDelta) <= DATE_WINDOW_DAYS,
		)
		.sort(
			(a, b) =>
				a.amountDelta - b.amountDelta ||
				Math.abs(a.dayDelta) - Math.abs(b.dayDelta) ||
				// Stable final tiebreaker, newest first (matches the transaction list).
				b.id - a.id,
		);
}
