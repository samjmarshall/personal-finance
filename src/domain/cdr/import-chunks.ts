const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back an import may reach: about RedBark's history depth. */
export const IMPORT_MAX_YEARS = 7;

/** The first `YYYY-MM-DD` an import may start on: the same day `IMPORT_MAX_YEARS` before `today`. */
export function importEarliestDay(today: string): string {
	return `${Number(today.slice(0, 4)) - IMPORT_MAX_YEARS}${today.slice(4)}`;
}

export interface ImportWindow {
	/** `YYYY-MM-DD`, inclusive. */
	from: string;
	/** `YYYY-MM-DD`, inclusive. */
	to: string;
}

/**
 * Splits an inclusive day range into windows of at most `days` days, with no gap
 * or overlap. Small windows keep each RedBark read under its 5,000-row cap.
 */
export function importChunks(
	from: string,
	to: string,
	days = 90,
): ImportWindow[] {
	const end = Date.parse(to);
	const chunks: ImportWindow[] = [];
	for (let start = Date.parse(from); start <= end; start += days * DAY_MS) {
		chunks.push({
			from: dayOf(start),
			to: dayOf(Math.min(start + (days - 1) * DAY_MS, end)),
		});
	}
	return chunks;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
