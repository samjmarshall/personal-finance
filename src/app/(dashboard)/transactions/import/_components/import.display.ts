import type { CdrImport, LatestImport } from "~/domain/cdr";
import type { ReconcileCounts } from "~/domain/transactions";
import { CdrImportStatus, HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import {
	dayNumberInZone,
	formatCurrency,
	formatDate,
	utcDayKey,
} from "~/lib/utils";

/** Where an import stands for the member. Stalled: queued or running, but the server has given up on it. */
export type ImportPhase =
	| "waiting"
	| "importing"
	| "stalled"
	| "done"
	| "failed";

export function importPhase({
	status,
	active,
}: Pick<LatestImport, "status" | "active">): ImportPhase {
	if (status === CdrImportStatus.Done) return "done";
	if (status === CdrImportStatus.Failed) return "failed";
	if (!active) return "stalled";
	return status === CdrImportStatus.Running ? "importing" : "waiting";
}

const PHASE_LABEL: Record<ImportPhase, string> = {
	waiting: "Waiting to start",
	importing: "Importing",
	stalled: "Didn't finish",
	done: "Done",
	failed: "Failed",
};

export function importStatusLabel(
	run: Pick<LatestImport, "status" | "active">,
): string {
	return PHASE_LABEL[importPhase(run)];
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

// Stored as UTC midnight of each bare day; a local render would show the day before west of UTC.
export function importRange({
	fromDate,
	toDate,
}: Pick<CdrImport, "fromDate" | "toDate">): string {
	return `${formatDate(utcDayKey(fromDate))} – ${formatDate(utcDayKey(toDate))}`;
}

/** The bank's day against the member's, in household days, as the reconcile counts them. Null on the same day. */
export function dayGapLabel(bank: Date, mine: Date): string | null {
	const gap =
		dayNumberInZone(bank, HOUSEHOLD_TIME_ZONE) -
		dayNumberInZone(mine, HOUSEHOLD_TIME_ZONE);
	if (gap === 0) return null;
	const days = Math.abs(gap) === 1 ? "1 day" : `${Math.abs(gap)} days`;
	return `${days} ${gap > 0 ? "later" : "earlier"} than yours`;
}

/** The bank's amount against the member's, by size, so a refund reads the same way. Null when equal to the cent. */
export function amountGapLabel(bank: number, mine: number): string | null {
	const cents =
		Math.round(Math.abs(bank) * 100) - Math.round(Math.abs(mine) * 100);
	if (cents === 0) return null;
	return `${formatCurrency(Math.abs(cents) / 100)} ${cents > 0 ? "more" : "less"} than yours`;
}
