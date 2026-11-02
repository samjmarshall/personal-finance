import { utcDayKey } from "~/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
// Small windows keep each RedBark read under its 5,000-row cap.
const WINDOW_DAYS = 90;

/** How far back an import may reach: about RedBark's history depth. */
export const IMPORT_MAX_YEARS = 7;

/** The first `YYYY-MM-DD` an import may start on: the same day `IMPORT_MAX_YEARS` before `today`. */
export function importEarliestDay(today: string): string {
	// The span isn't a multiple of 4 years, so that far back from a leap day is never a leap year.
	const monthDay = today.slice(4) === "-02-29" ? "-02-28" : today.slice(4);
	return `${Number(today.slice(0, 4)) - IMPORT_MAX_YEARS}${monthDay}`;
}

/** Why an inclusive `YYYY-MM-DD` range can't import, or null. The form and the server both ask, so they say the same words. */
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

/** A whole import's range, or one window of it. */
export interface DayRange {
	/** `YYYY-MM-DD`, inclusive. */
	from: string;
	/** `YYYY-MM-DD`, inclusive. */
	to: string;
}

/** Splits an inclusive day range into windows of at most `WINDOW_DAYS` days, with no gap or overlap. */
export function importWindows(from: string, to: string): DayRange[] {
	const end = Date.parse(to);
	const windows: DayRange[] = [];
	for (
		let start = Date.parse(from);
		start <= end;
		start += WINDOW_DAYS * DAY_MS
	) {
		windows.push({
			from: utcDayKey(new Date(start)),
			to: utcDayKey(
				new Date(Math.min(start + (WINDOW_DAYS - 1) * DAY_MS, end)),
			),
		});
	}
	return windows;
}
