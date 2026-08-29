// Half-open local-date windows [from, to): from inclusive, to exclusive. All
// arithmetic is on local calendar dates (like toDateInput) so an edge never
// walks a day under DST or for users behind UTC.

export type PeriodKind = "month" | "fortnight";

export interface PeriodWindow {
	from: Date;
	to: Date;
}

const MS_PER_DAY = 86_400_000;

// Local calendar date as a whole-day index. Date.UTC pins midnight UTC, so the
// difference of two indices is an exact day count regardless of DST.
function localDayNumber(d: Date): number {
	return Math.floor(
		Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY,
	);
}

function addDays(d: Date, days: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function monthWindow(ref: Date): PeriodWindow {
	return {
		from: new Date(ref.getFullYear(), ref.getMonth(), 1),
		to: new Date(ref.getFullYear(), ref.getMonth() + 1, 1),
	};
}

// The 14-day window on the anchor's grid that contains ref. anchor's time of
// day is ignored — only its calendar date seeds the grid.
export function fortnightWindow(anchor: Date, ref: Date): PeriodWindow {
	const offset = localDayNumber(ref) - localDayNumber(anchor);
	const index = Math.floor(offset / 14);
	const from = addDays(anchor, index * 14);
	return { from, to: addDays(from, 14) };
}

export function shiftWindow(
	window: PeriodWindow,
	kind: PeriodKind,
	step: number,
): PeriodWindow {
	if (kind === "month") {
		return monthWindow(
			new Date(window.from.getFullYear(), window.from.getMonth() + step, 1),
		);
	}
	// Fortnight windows are exactly 14 days and already grid-aligned, so a plain
	// day shift preserves alignment without the anchor.
	return {
		from: addDays(window.from, step * 14),
		to: addDays(window.to, step * 14),
	};
}
