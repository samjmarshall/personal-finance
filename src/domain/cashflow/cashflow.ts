import type { Expense } from "~/domain/expenses";
import type { Income } from "~/domain/income";
import { CommitmentKind } from "~/lib/constants";
import {
	fortnightWindow,
	monthWindow,
	type PeriodKind,
	type PeriodWindow,
	shiftWindow,
} from "~/lib/period";
import { isPast, toDateInput } from "~/lib/utils";
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

// Fortnight buckets read as a start date ("14 Aug"); month buckets as the month
// name ("Aug"). utils.ts's formatters are module-private, so build our own.
const dayMonthLabel = new Intl.DateTimeFormat("en-AU", {
	day: "numeric",
	month: "short",
});
const monthLabel = new Intl.DateTimeFormat("en-AU", { month: "short" });

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

	const buckets = windows.map((window, index): CashflowBucket => {
		const bucket: CashflowBucket = {
			key: toDateInput(window.from),
			label:
				kind === "fortnight"
					? dayMonthLabel.format(window.from)
					: monthLabel.format(window.from),
			spend: 0,
			inflow: 0,
			balance: null,
			isCurrent: index === CURRENT_INDEX,
			items: [],
		};

		const isCurrent = index === CURRENT_INDEX;
		const isForward = index > CURRENT_INDEX;

		// Historic and current buckets carry actual transactions; the current bucket
		// only up to now, leaving the rest of its window to projection (date-split).
		if (!isForward) {
			const upTo = isCurrent ? input.now : undefined;
			for (const t of input.transactions) {
				if (!withinWindow(t.date, window)) continue;
				if (upTo && t.date.getTime() > upTo.getTime()) continue;
				if (t.amount > 0) bucket.spend += t.amount;
				else if (t.amount < 0) bucket.inflow += -t.amount;
			}
		}

		// Current and forward buckets carry projected commitments.
		if (isForward || isCurrent) {
			for (const c of commitments) {
				const figure =
					c.kind === CommitmentKind.OneTime
						? oneTimeFigure(c, window, isCurrent, input.now)
						: recurringFigure(c, window, isCurrent, input.now);
				if (figure === 0) continue;
				addContribution(bucket, c, figure);
			}
		}

		return bucket;
	});

	applyBalanceLine(buckets, windows, input.anchor);
	return { buckets, hasBalanceAnchor: input.anchor != null };
}

// 25 half-open windows via period.ts. A fortnight request with no anchor degrades
// to the month grid (design: missing cadence degrades, never errors).
function buildGrid(
	now: Date,
	periodKind: PeriodKind,
	fortnightAnchor: Date | null,
): { windows: PeriodWindow[]; kind: PeriodKind } {
	const kind: PeriodKind =
		periodKind === "fortnight" && fortnightAnchor ? "fortnight" : "month";
	const current =
		kind === "fortnight"
			? fortnightWindow(fortnightAnchor as Date, now)
			: monthWindow(now);
	const windows = Array.from({ length: GRID_RADIUS * 2 + 1 }, (_, i) =>
		shiftWindow(current, kind, i - GRID_RADIUS),
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
	const full =
		c.year * (bucketDays(window) / daysInYear(window.from.getFullYear()));
	if (!isCurrent) return full;
	// Current bucket: actuals already cover [from, now]; smear only the remaining days.
	const remaining = remainingDaysAfterToday(window, now);
	return c.year * (remaining / daysInYear(window.from.getFullYear()));
}

// A spike counts unless it has already elapsed in the current bucket, where it is
// assumed to sit in that bucket's actuals (kills the salary/rent double-count).
function spikeInWindow(
	landing: Date | null,
	isCurrent: boolean,
	now: Date,
): boolean {
	if (!landing) return false;
	if (isCurrent && landing.getTime() <= now.getTime()) return false;
	return true;
}

function oneTimeFigure(
	c: Commitment,
	window: PeriodWindow,
	isCurrent: boolean,
	now: Date,
): number {
	if (c.expectedDate == null || c.amount == null) return 0;
	if (c.direction === "spend") {
		const remaining = Math.max(c.amount - c.consumed, 0);
		if (remaining <= 0) return 0;
		// A past, still-unconsumed remaining rolls into the current bucket rather
		// than staying in a historic one (never silently drops).
		if (isPast(c.expectedDate, now)) return isCurrent ? remaining : 0;
		return withinWindow(c.expectedDate, window) ? remaining : 0;
	}
	// Income: a past one-time drop-out (assumed received — no FK to measure receipt).
	if (isPast(c.expectedDate, now)) return 0;
	return withinWindow(c.expectedDate, window) ? c.amount : 0;
}

// Walk the running balance out from the snapshot's bucket in both directions;
// null everywhere when no snapshot anchors it. Invariant across every neighbour:
// balance[i+1] = balance[i] + (inflow − spend)[i+1].
function applyBalanceLine(
	buckets: CashflowBucket[],
	windows: PeriodWindow[],
	anchor: { amount: number; asOf: Date } | null,
): void {
	if (!anchor) return;
	const pivot = clamp(pivotIndex(windows, anchor.asOf), 0, buckets.length - 1);
	const net = (b: CashflowBucket) => b.inflow - b.spend;

	const pivotBucket = buckets[pivot];
	if (!pivotBucket) return;
	pivotBucket.balance = anchor.amount;
	for (let i = pivot + 1; i < buckets.length; i++) {
		const cur = buckets[i];
		const prev = buckets[i - 1];
		if (cur && prev) cur.balance = (prev.balance ?? 0) + net(cur);
	}
	for (let i = pivot - 1; i >= 0; i--) {
		const cur = buckets[i];
		const next = buckets[i + 1];
		if (cur && next) cur.balance = (next.balance ?? 0) - net(next);
	}
}

// --- local calendar-date helpers (period.ts owns window math; these count days) ---

// Whole-day index; Date.UTC pins midnight so a difference is an exact day count.
function dayNumber(d: Date): number {
	return Math.floor(
		Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY,
	);
}

function withinWindow(d: Date, window: PeriodWindow): boolean {
	return (
		d.getTime() >= window.from.getTime() && d.getTime() < window.to.getTime()
	);
}

function bucketDays(window: PeriodWindow): number {
	return dayNumber(window.to) - dayNumber(window.from);
}

// Days strictly after today up to the window end — the span a current-bucket smear
// still projects (today and earlier are covered by actuals).
function remainingDaysAfterToday(window: PeriodWindow, now: Date): number {
	return clamp(
		dayNumber(window.to) - dayNumber(now) - 1,
		0,
		bucketDays(window),
	);
}

function daysInMonth(year: number, month1: number): number {
	return new Date(year, month1, 0).getDate();
}

function daysInYear(year: number): number {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

// (year, 0-based month) pairs a window touches — one for a month window, up to two
// for a fortnight window straddling a month boundary.
function monthsTouching(
	window: PeriodWindow,
): { year: number; month0: number }[] {
	const start = {
		year: window.from.getFullYear(),
		month0: window.from.getMonth(),
	};
	const lastDay = new Date(dayNumber(window.to) * MS_PER_DAY - MS_PER_DAY);
	const end = { year: lastDay.getUTCFullYear(), month0: lastDay.getUTCMonth() };
	if (end.year === start.year && end.month0 === start.month0) return [start];
	return [start, end];
}

// The annual due date for a year the window touches, clamped to month-end, if it
// falls inside the window; else null (it lands in a different bucket).
function annualLanding(
	window: PeriodWindow,
	dueMonth: number,
	dueDay: number,
): Date | null {
	for (const { year, month0 } of monthsTouching(window)) {
		if (month0 + 1 !== dueMonth) continue;
		const day = Math.min(dueDay, daysInMonth(year, dueMonth));
		const landing = new Date(year, dueMonth - 1, day);
		if (withinWindow(landing, window)) return landing;
	}
	return null;
}

// The monthly due date (clamped to month-end) for a month the window touches, if
// it falls inside the window; else null.
function monthlyLanding(window: PeriodWindow, dueDay: number): Date | null {
	for (const { year, month0 } of monthsTouching(window)) {
		const day = Math.min(dueDay, daysInMonth(year, month0 + 1));
		const landing = new Date(year, month0, day);
		if (withinWindow(landing, window)) return landing;
	}
	return null;
}

// The bucket whose window contains asOf, clamped to the grid when the snapshot
// pre-/post-dates it (a recent snapshot usually sits near the current bucket).
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
