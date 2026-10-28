import {
	type CdrImport,
	IMPORT_MAX_YEARS,
	importEarliestDay,
	type LatestImport,
} from "~/domain/cdr";
import type { ReconcileCounts } from "~/domain/transactions";
import { CdrImportStatus, HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import { dayKeyInZone, formatCurrency, formatDate } from "~/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABEL: Record<CdrImportStatus, string> = {
	[CdrImportStatus.Queued]: "Waiting to start",
	[CdrImportStatus.Running]: "Importing",
	[CdrImportStatus.Done]: "Done",
	[CdrImportStatus.Failed]: "Failed",
};

/** "Didn't finish" for a queued or running import the server has given up on. */
export function importStatusLabel({
	status,
	active,
}: Pick<LatestImport, "status" | "active">): string {
	const unfinished =
		status === CdrImportStatus.Queued || status === CdrImportStatus.Running;
	return unfinished && !active ? "Didn't finish" : STATUS_LABEL[status];
}

/** `flagged` nets out released reviews, so it can dip below 0; shown floored. */
export function importCounts({
	added,
	adopted,
	flagged,
	known,
}: ReconcileCounts): string[] {
	return [
		`Added ${added.toLocaleString("en-AU")}`,
		`Matched to yours ${adopted.toLocaleString("en-AU")}`,
		`To review ${Math.max(flagged, 0).toLocaleString("en-AU")}`,
		`Already here ${known.toLocaleString("en-AU")}`,
	];
}

/** Why a `YYYY-MM-DD` range can't run, or null. The server's checks and words, so a member hears them before submitting. */
export function importRangeError(
	from: string,
	to: string,
	today: string,
): string | null {
	if (!from || !to) return "Pick a From and a To day.";
	if (from > to) return "The From day must be on or before the To day.";
	if (to > today) return "The To day can't be after today.";
	if (from < importEarliestDay(today))
		return `An import can reach back ${IMPORT_MAX_YEARS} years at most.`;
	return null;
}

// Stored as UTC midnight of each bare day; a local render would show the day before west of UTC.
export function importRange({
	fromDate,
	toDate,
}: Pick<CdrImport, "fromDate" | "toDate">): string {
	const bareDay = (value: Date) => value.toISOString().slice(0, 10);
	return `${formatDate(bareDay(fromDate))} – ${formatDate(bareDay(toDate))}`;
}

/** The bank's day against the member's, in household days, as the reconcile counts them. Null on the same day. */
export function dayGapLabel(bank: Date, mine: Date): string | null {
	const gap = householdDay(bank) - householdDay(mine);
	if (gap === 0) return null;
	const days = Math.abs(gap) === 1 ? "1 day" : `${Math.abs(gap)} days`;
	return `${days} ${gap > 0 ? "later" : "earlier"}`;
}

/** The bank's amount against the member's, by size, so a refund reads the same way. Null to the cent. */
export function amountGapLabel(bank: number, mine: number): string | null {
	const cents =
		Math.round(Math.abs(bank) * 100) - Math.round(Math.abs(mine) * 100);
	if (cents === 0) return null;
	return `${formatCurrency(Math.abs(cents) / 100)} ${cents > 0 ? "more" : "less"}`;
}

function householdDay(value: Date): number {
	return (
		Date.parse(`${dayKeyInZone(value, HOUSEHOLD_TIME_ZONE)}T00:00:00Z`) / DAY_MS
	);
}
