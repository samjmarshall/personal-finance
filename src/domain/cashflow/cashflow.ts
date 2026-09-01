import type { Expense } from "~/domain/expenses";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import type { PeriodKind, PeriodWindow } from "~/lib/period";
import type { CashflowBucket, CashflowResult } from "./cashflow.interface";

export interface BuildCashflowInput {
	now: Date;
	periodKind: PeriodKind;
	fortnightAnchor: Date | null; // null + fortnight → fall back to month grid
	transactions: { date: Date; amount: number }[];
	expenses: Expense[];
	incomes: Income[];
	consumedByExpenseId: Map<number, number>;
	anchor: { amount: number; asOf: Date } | null;
}

const GRID_RADIUS = 12; // 12 back · current · 12 forward = 25 buckets
const CURRENT_INDEX = GRID_RADIUS;
const MS_PER_DAY = 86_400_000;

// This projection runs server-side, where server (UTC) time is the timing source of
// truth, so every calendar read here is UTC — the result never depends on the machine's
// zone. period.ts stays LOCAL: it also feeds client-side display (unplanned-view), which
// wants the user's calendar. The two grids serve different callers and are not shared.
const dayMonthLabel = new Intl.DateTimeFormat("en-AU", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-AU", {
	month: "short",
	timeZone: "UTC",
});

// A commitment normalised across Expense/Income: Spend contributes +, Inflow −,
// matching CashflowItem's sign. Lets one projection path serve both directions.
interface Commitment {
	label: string;
	kind: CommitmentKind;
	direction: "spend" | "inflow";
	amount: number | null;
	expectedDate: Date | null;
	dueDay: number | null;
	dueMonth: number | null;
	month: number;
	year: number;
	consumed: number; // one-time expense consumption; 0 for income
}

export function buildCashflow(input: BuildCashflowInput): CashflowResult {
	const { windows, kind } = buildGrid(
		input.now,
		input.periodKind,
		input.fortnightAnchor,
	);
	const commitments = toCommitments(
		input.expenses,
		input.incomes,
		input.consumedByExpenseId,
	);
	const horizonEnd = windows[windows.length - 1]?.to ?? input.now;

	// The current bucket is date-split at `now`; the balance line needs its two halves
	// (pre-now actuals vs post-now projections) kept apart, so capture them here.
	let currentActualNet = 0;
	let currentProjectedNet = 0;

	const buckets = windows.map((window, index): CashflowBucket => {
		const isCurrent = index === CURRENT_INDEX;
		const isForward = index > CURRENT_INDEX;
		const isLast = index === windows.length - 1;

		const bucket: CashflowBucket = {
			key: utcDateKey(window.from),
			label:
				kind === "fortnight"
					? dayMonthLabel.format(window.from)
					: monthLabel.format(window.from),
			spend: 0,
			inflow: 0,
			balance: null,
			isCurrent,
			items: [],
		};

		// Historic and current buckets carry actual transactions; the current bucket
		// only up to now, leaving the rest of its window to projection (date-split).
		let actualSpend = 0;
		let actualInflow = 0;
		if (!isForward) {
			const upTo = isCurrent ? input.now : undefined;
			for (const t of input.transactions) {
				if (!withinWindow(t.date, window)) continue;
				if (upTo && t.date.getTime() > upTo.getTime()) continue;
				if (t.amount > 0) actualSpend += t.amount;
				else if (t.amount < 0) actualInflow += -t.amount;
			}
		}
		bucket.spend += actualSpend;
		bucket.inflow += actualInflow;

		// Current and forward buckets carry projected commitments.
		if (isForward || isCurrent) {
			for (const c of commitments) {
				const figure =
					c.kind === CommitmentKind.OneTime
						? oneTimeFigure(c, window, isCurrent, isLast, horizonEnd, input.now)
						: recurringFigure(c, window, isCurrent, input.now);
				if (figure === 0) continue;
				addContribution(bucket, c, figure);
			}
		}

		if (isCurrent) {
			// Actuals were summed first, so whatever the projection loop added on top is
			// the post-now half of the date-split.
			currentActualNet = actualInflow - actualSpend;
			currentProjectedNet =
				bucket.inflow - actualInflow - (bucket.spend - actualSpend);
		}

		return bucket;
	});

	applyBalanceLine(buckets, windows, input.anchor, {
		currentActualNet,
		currentProjectedNet,
	});
	return { buckets, hasBalanceAnchor: input.anchor != null };
}

// 25 half-open UTC windows (12 back · current · 12 forward). A fortnight request with no
// anchor degrades to the month grid (design: missing cadence degrades, never errors).
function buildGrid(
	now: Date,
	periodKind: PeriodKind,
	fortnightAnchor: Date | null,
): { windows: PeriodWindow[]; kind: PeriodKind } {
	const kind: PeriodKind =
		periodKind === "fortnight" && fortnightAnchor ? "fortnight" : "month";
	const current =
		kind === "fortnight"
			? utcFortnightWindow(fortnightAnchor as Date, now)
			: utcMonthWindow(now);
	const windows = Array.from({ length: GRID_RADIUS * 2 + 1 }, (_, i) =>
		utcShiftWindow(current, kind, i - GRID_RADIUS),
	);
	return { windows, kind };
}

function toCommitments(
	expenses: Expense[],
	incomes: Income[],
	consumedByExpenseId: Map<number, number>,
): Commitment[] {
	const fromExpenses = expenses.map(
		(e): Commitment => ({
			label: e.name,
			kind: e.kind,
			direction: "spend",
			amount: e.amount,
			expectedDate: e.expectedDate,
			dueDay: e.dueDay,
			dueMonth: e.dueMonth,
			month: e.month,
			year: e.year,
			consumed: consumedByExpenseId.get(e.id) ?? 0,
		}),
	);
	const fromIncomes = incomes.map(
		(i): Commitment => ({
			label: i.source,
			kind: i.kind,
			direction: "inflow",
			amount: i.amount,
			expectedDate: i.expectedDate,
			dueDay: i.dueDay,
			dueMonth: i.dueMonth,
			month: i.month,
			year: i.year,
			consumed: 0,
		}),
	);
	return [...fromExpenses, ...fromIncomes];
}

// Push a signed tooltip item and fold its magnitude into the bucket's Spend/Inflow.
function addContribution(
	bucket: CashflowBucket,
	c: Commitment,
	figure: number,
): void {
	const sign = c.direction === "spend" ? 1 : -1;
	bucket.items.push({ label: c.label, amount: sign * figure });
	if (c.direction === "spend") bucket.spend += figure;
	else bucket.inflow += figure;
}

// Timing-keyed cadence (Basis is not stored): dueMonth → annual spike; dueDay →
// monthly spike; neither → smear. Returns the unsigned magnitude for this window.
function recurringFigure(
	c: Commitment,
	window: PeriodWindow,
	isCurrent: boolean,
	now: Date,
): number {
	if (c.dueMonth != null) {
		const landing = annualLanding(window, c.dueMonth, c.dueDay ?? 1);
		return spikeInWindow(landing, isCurrent, now) ? c.year : 0;
	}
	if (c.dueDay != null) {
		const landing = monthlyLanding(window, c.dueDay);
		return spikeInWindow(landing, isCurrent, now) ? c.month : 0;
	}
	const yearDays = daysInYear(window.from.getUTCFullYear());
	const full = c.year * (bucketDays(window) / yearDays);
	if (!isCurrent) return full;
	// Current bucket: actuals already cover [from, now]; smear only the remaining days.
	return c.year * (remainingDaysAfterToday(window, now) / yearDays);
}

// A spike counts unless it lands on a UTC day already elapsed in the current bucket,
// where it is assumed to sit in that bucket's actuals (kills the salary/rent double-
// count). A spike due *today* is still upcoming, so it counts.
function spikeInWindow(
	landing: Date | null,
	isCurrent: boolean,
	now: Date,
): boolean {
	if (!landing) return false;
	if (isCurrent && isPastUtc(landing, now)) return false;
	return true;
}

function oneTimeFigure(
	c: Commitment,
	window: PeriodWindow,
	isCurrent: boolean,
	isLast: boolean,
	horizonEnd: Date,
	now: Date,
): number {
	if (c.expectedDate == null || c.amount == null) return 0;
	// A future one-time lands in its own bucket, or — when its date falls past the grid's
	// horizon — clamps into the last bucket rather than silently vanishing (the fortnight
	// grid reaches ~5.5 months, the month grid a year, so the same row must not drop on
	// the shorter grid). Extend later by widening the grid or flagging beyond-horizon.
	const beyondHorizon = c.expectedDate.getTime() >= horizonEnd.getTime();
	const landsHere =
		withinWindow(c.expectedDate, window) || (isLast && beyondHorizon);

	if (c.direction === "spend") {
		const remaining = Math.max(c.amount - c.consumed, 0);
		if (remaining <= 0) return 0;
		// A past, still-unconsumed remaining rolls into the current bucket rather than
		// staying in a historic one (never silently drops).
		if (isPastUtc(c.expectedDate, now)) return isCurrent ? remaining : 0;
		return landsHere ? remaining : 0;
	}
	// Income: a past one-time drops out (assumed received — no FK to measure receipt).
	if (isPastUtc(c.expectedDate, now)) return 0;
	return landsHere ? c.amount : 0;
}

// Walk the running balance out from the snapshot's bucket in both directions; null
// everywhere when no snapshot anchors it. The pivot bucket's net is split at the anchor:
// the current bucket is date-split at now, so its pre-anchor half is the actuals (rolls
// backward) and its post-anchor half is the projections (rolls forward) — without the
// split, upcoming commitments still due later this period never touch the line.
function applyBalanceLine(
	buckets: CashflowBucket[],
	windows: PeriodWindow[],
	anchor: { amount: number; asOf: Date } | null,
	pivotSplit: { currentActualNet: number; currentProjectedNet: number },
): void {
	if (!anchor) return;
	const pivot = pivotIndex(windows, anchor.asOf);
	const pivotBucket = buckets[pivot];
	if (!pivotBucket) return;
	const net = (b: CashflowBucket) => b.inflow - b.spend;

	// A snapshot dated to a non-current bucket is rare; approximate the anchor at that
	// bucket's start so its whole net rolls forward from the anchor.
	const preNet = pivot === CURRENT_INDEX ? pivotSplit.currentActualNet : 0;
	const postNet =
		pivot === CURRENT_INDEX ? pivotSplit.currentProjectedNet : net(pivotBucket);

	pivotBucket.balance = anchor.amount + postNet;
	for (let i = pivot + 1; i < buckets.length; i++) {
		const cur = buckets[i];
		const prev = buckets[i - 1];
		if (cur && prev) cur.balance = (prev.balance ?? 0) + net(cur);
	}
	const before = buckets[pivot - 1];
	if (before) {
		before.balance = anchor.amount - preNet;
		for (let i = pivot - 2; i >= 0; i--) {
			const cur = buckets[i];
			const next = buckets[i + 1];
			if (cur && next) cur.balance = (next.balance ?? 0) - net(next);
		}
	}
}

// --- local calendar-date helpers (all UTC — server time is the timing source of truth) ---

// Whole UTC-day index; the difference of two indices is an exact day count (UTC has no
// DST). Reading via getTime keeps it zone-independent.
function utcDayNumber(d: Date): number {
	return Math.floor(d.getTime() / MS_PER_DAY);
}

// YYYY-MM-DD of a UTC-midnight window start — wire-safe x-axis key, computed in UTC so
// it never walks a day for a behind-UTC caller.
function utcDateKey(d: Date): string {
	const year = d.getUTCFullYear();
	const month = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// Past by UTC calendar day: a commitment due *today* is upcoming, not past.
function isPastUtc(date: Date, now: Date): boolean {
	return utcDayNumber(date) < utcDayNumber(now);
}

function withinWindow(d: Date, window: PeriodWindow): boolean {
	return (
		d.getTime() >= window.from.getTime() && d.getTime() < window.to.getTime()
	);
}

function bucketDays(window: PeriodWindow): number {
	return utcDayNumber(window.to) - utcDayNumber(window.from);
}

// Days strictly after today up to the window end — the span a current-bucket smear
// still projects (today and earlier are covered by actuals).
function remainingDaysAfterToday(window: PeriodWindow, now: Date): number {
	return clamp(
		utcDayNumber(window.to) - utcDayNumber(now) - 1,
		0,
		bucketDays(window),
	);
}

function daysInMonth(year: number, month1: number): number {
	return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function daysInYear(year: number): number {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

function utcMonthWindow(ref: Date): PeriodWindow {
	const year = ref.getUTCFullYear();
	const month = ref.getUTCMonth();
	return {
		from: new Date(Date.UTC(year, month, 1)),
		to: new Date(Date.UTC(year, month + 1, 1)),
	};
}

// The 14-day window on the anchor's UTC grid that contains ref. anchor's time of day is
// ignored — only its UTC calendar date seeds the grid.
function utcFortnightWindow(anchor: Date, ref: Date): PeriodWindow {
	const index = Math.floor((utcDayNumber(ref) - utcDayNumber(anchor)) / 14);
	const anchorMidnight = new Date(
		Date.UTC(
			anchor.getUTCFullYear(),
			anchor.getUTCMonth(),
			anchor.getUTCDate(),
		),
	);
	const from = addUtcDays(anchorMidnight, index * 14);
	return { from, to: addUtcDays(from, 14) };
}

function utcShiftWindow(
	window: PeriodWindow,
	kind: PeriodKind,
	step: number,
): PeriodWindow {
	if (kind === "month") {
		return utcMonthWindow(
			new Date(
				Date.UTC(
					window.from.getUTCFullYear(),
					window.from.getUTCMonth() + step,
					1,
				),
			),
		);
	}
	// Fortnight windows are exactly 14 days and already grid-aligned, so a plain day
	// shift preserves alignment without the anchor.
	return {
		from: addUtcDays(window.from, step * 14),
		to: addUtcDays(window.to, step * 14),
	};
}

function addUtcDays(d: Date, days: number): Date {
	return new Date(d.getTime() + days * MS_PER_DAY);
}

// (year, 0-based month) pairs a window touches — one for a month window, up to two for a
// fortnight window straddling a month boundary.
function monthsTouching(
	window: PeriodWindow,
): { year: number; month0: number }[] {
	const start = {
		year: window.from.getUTCFullYear(),
		month0: window.from.getUTCMonth(),
	};
	const lastDay = new Date(window.to.getTime() - MS_PER_DAY);
	const end = { year: lastDay.getUTCFullYear(), month0: lastDay.getUTCMonth() };
	if (end.year === start.year && end.month0 === start.month0) return [start];
	return [start, end];
}

// The annual due date for a year the window touches, clamped to month-end, if it falls
// inside the window; else null (it lands in a different bucket).
function annualLanding(
	window: PeriodWindow,
	dueMonth: number,
	dueDay: number,
): Date | null {
	for (const { year, month0 } of monthsTouching(window)) {
		if (month0 + 1 !== dueMonth) continue;
		const day = Math.min(dueDay, daysInMonth(year, dueMonth));
		const landing = new Date(Date.UTC(year, dueMonth - 1, day));
		if (withinWindow(landing, window)) return landing;
	}
	return null;
}

// The monthly due date (clamped to month-end) for a month the window touches, if it
// falls inside the window; else null.
function monthlyLanding(window: PeriodWindow, dueDay: number): Date | null {
	for (const { year, month0 } of monthsTouching(window)) {
		const day = Math.min(dueDay, daysInMonth(year, month0 + 1));
		const landing = new Date(Date.UTC(year, month0, day));
		if (withinWindow(landing, window)) return landing;
	}
	return null;
}

// The bucket whose window contains asOf, clamped to the grid when the snapshot pre-/post-
// dates it (a recent snapshot usually sits near the current bucket).
function pivotIndex(windows: PeriodWindow[], asOf: Date): number {
	const found = windows.findIndex((w) => withinWindow(asOf, w));
	if (found !== -1) return found;
	return asOf.getTime() < (windows[0]?.from.getTime() ?? 0)
		? 0
		: windows.length - 1;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
