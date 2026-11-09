import type { CdrImport, LatestImport } from "~/domain/cdr";
import {
	type PossibleDuplicateReview,
	type ReconcileCounts,
	SIMILAR_SCORE,
	SIMILAR_WORDS,
	sharedWords,
} from "~/domain/transactions";
import { Answer, CdrImportStatus, HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import {
	dayNumberInZone,
	formatCount,
	formatCurrency,
	formatDate,
	toCents,
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

/** This run's outcomes; the "To review" heading counts every waiting one. `flagged` nets out released reviews, so it can dip below 0; shown floored. */
export function importCountLabels({
	added,
	adopted,
	flagged,
	known,
}: ReconcileCounts): string[] {
	return [
		`Added ${formatCount(added)}`,
		`Matched to yours ${formatCount(adopted)}`,
		`Flagged ${formatCount(Math.max(flagged, 0))}`,
		`Already here ${formatCount(known)}`,
	];
}

// Stored as UTC midnight of each bare day; a local render would show the day before west of UTC.
export function importRangeLabel({
	fromDate,
	toDate,
}: Pick<CdrImport, "fromDate" | "toDate">): string {
	return `${formatDate(utcDayKey(fromDate))} – ${formatDate(utcDayKey(toDate))}`;
}

/** The bank's day against the member's, in household days, as the reconcile counts them. Null on the same day. */
export function dayGapLabel(bank: Date, mine: Date): string | null {
	const gap = householdDays(bank, mine);

	if (gap === 0) return null;

	const days = Math.abs(gap) === 1 ? "1 day" : `${Math.abs(gap)} days`;

	return `${days} ${gap > 0 ? "later" : "earlier"} than yours`;
}

/** The bank's amount against the member's, by size, so a refund reads the same way. Null when equal to the cent; only an edit to yours after the flag splits them. */
export function amountGapLabel(bank: number, mine: number): string | null {
	const cents = Math.abs(toCents(bank)) - Math.abs(toCents(mine));

	if (cents === 0) return null;

	return `${formatCurrency(Math.abs(cents) / 100)} ${cents > 0 ? "more" : "less"} than yours`;
}

/** Drives the legend and every row's answers, so their order can't drift. */
export const ANSWERS: {
	answer: Answer;
	label: string;
	effect: string;
}[] = [
	{
		answer: Answer.KeepMine,
		label: "Keep mine",
		effect: "drops the bank's copy.",
	},
	{
		answer: Answer.UseBank,
		label: "Use bank's",
		effect:
			"gives yours its date and amount, and keeps your description, category, expense and receipt.",
	},
	{
		answer: Answer.BothReal,
		label: "Both are real",
		effect: "adds the bank's row.",
	},
];

export interface DuplicatePile {
	key: "similar_description" | "different_description";
	title: string;
	why: string;
	/** What the pile's fill button picks for its unanswered rows. */
	suggestion: Answer;
	reviews: PossibleDuplicateReview[];
}

// Every pair shares its amount to the cent, so the descriptions are what tell a copy from a twin.
const PILES: Omit<DuplicatePile, "reviews">[] = [
	{
		key: "similar_description",
		title: "Similar description",
		why: "The descriptions match. Almost always the same purchase.",
		suggestion: Answer.UseBank,
	},
	{
		key: "different_description",
		title: "Different description",
		why: "The descriptions don't match. Most likely two purchases.",
		suggestion: Answer.BothReal,
	},
];

/** Reviews by how alike the descriptions are, similar first; empty piles left out. Each pile is nearest day first, then newest. */
export function duplicatePiles(
	reviews: PossibleDuplicateReview[],
): DuplicatePile[] {
	const sorted = reviews
		.map((review) => ({ review, days: dayGap(review) }))
		.sort(
			(x, y) =>
				x.days - y.days ||
				y.review.bank.date.getTime() - x.review.bank.date.getTime() ||
				y.review.id - x.review.id,
		)
		.map(({ review }) => review);
	const isSimilar = ({
		bank,
		mine,
		descriptionScore,
	}: PossibleDuplicateReview) =>
		descriptionScore === null
			? sharedWords(bank.description, mine.description) >= SIMILAR_WORDS
			: descriptionScore >= SIMILAR_SCORE;
	const byPile: Record<DuplicatePile["key"], PossibleDuplicateReview[]> = {
		similar_description: sorted.filter(isSimilar),
		different_description: sorted.filter((review) => !isSimilar(review)),
	};

	return PILES.map((pile) => ({ ...pile, reviews: byPile[pile.key] })).filter(
		(pile) => pile.reviews.length > 0,
	);
}

/** How far apart the two rows are, in household days. */
function dayGap({ bank, mine }: PossibleDuplicateReview): number {
	return Math.abs(householdDays(bank.date, mine.date));
}

/** Household days from the member's row to the bank's; positive when the bank's is later. */
function householdDays(bank: Date, mine: Date): number {
	return (
		dayNumberInZone(bank, HOUSEHOLD_TIME_ZONE) -
		dayNumberInZone(mine, HOUSEHOLD_TIME_ZONE)
	);
}

/** The pile button: picks `label` for the rows still without an answer. */
export function fillLabel(
	label: string,
	unanswered: number,
	total: number,
): string {
	if (unanswered === 0) return "All answered";

	if (unanswered === total) {
		return total === 1
			? `${label} for this one`
			: `${label} for all ${formatCount(total)}`;
	}

	return unanswered === 1
		? `${label} for the last one`
		: `${label} for the other ${formatCount(unanswered)}`;
}
