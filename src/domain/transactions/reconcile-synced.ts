import { PossibleDuplicateStatus } from "~/lib/constants";
import { dayNumberInZone, toCents } from "~/lib/utils";
import {
	ADOPT_MEANING_SCORE,
	ADOPT_WORD_SCORE,
	type DescriptionScore,
	SIMILAR_SCORE,
	scoreDescriptions,
	type WordWeights,
} from "./description-score";
import type { SyncedTransaction, Transaction } from "./transaction.interface";

/** Furthest apart, in calendar days, a close pair may be. */
export const MATCH_DAYS = 7;

/** Fewest shared words for two descriptions to count as similar. Two is only "PAYPAL" and "AUS". */
export const SIMILAR_WORDS = 3;

/** Distinct words, case-blind; any run of non-letters or digits splits ("*SPOTIFY*P3E65F" is two). */
export function descriptionWords(text: string): Set<string> {
	return new Set(
		text
			.toUpperCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter(Boolean),
	);
}

/** How many distinct words two descriptions share. */
export function sharedWords(a: string, b: string): number {
	const words = descriptionWords(b);
	let shared = 0;

	for (const word of descriptionWords(a)) {
		if (words.has(word)) shared++;
	}

	return shared;
}

export interface ReconcileReview {
	id: number;
	externalId: string;
	status: PossibleDuplicateStatus;
	transactionId: number;
}

/** A row a bank row may pair with. `heldBy`: the pending review on it, if any. */
export interface MatchCandidate
	extends Pick<
		Transaction,
		| "id"
		| "date"
		| "amount"
		| "description"
		| "externalId"
		| "externalAccountId"
	> {
	heldBy: number | null;
	/** Top merged score of its pending reviews; null if none, or none saved a score. */
	heldScore: number | null;
}

export interface ReconcileInput {
	/** Unique by bank id. */
	incoming: SyncedTransaction[];
	/** Bank ids already in `transaction`. */
	knownIds: readonly string[];
	/** Every review, any status, for the incoming bank ids. */
	reviews: ReconcileReview[];
	candidates: MatchCandidate[];
	/** Every account id RedBark listed this run. */
	liveAccountIds: readonly string[];
	timeZone: string;
	/** Over every saved description plus the incoming ones. */
	weights: WordWeights;
	/** Embeddings by cleaned description; some may be missing. Null when nothing paired. */
	vectors: ReadonlyMap<string, number[]> | null;
}

export type MatchInput = Omit<ReconcileInput, "weights" | "vectors">;

export interface MatchPair {
	bank: SyncedTransaction;
	candidate: MatchCandidate;
	dayGap: number;
}

/** `heldBy` set: each review on the row is released into a row once the adoption lands. */
export interface Adoption {
	transactionId: number;
	row: SyncedTransaction;
	heldBy: number | null;
}

/** `reviewId` set: refresh that pending review; null: a new one. */
export interface Flag {
	transactionId: number;
	row: SyncedTransaction;
	reviewId: number | null;
	/** Merged score for a new review; null on a refresh, which keeps its saved one. */
	descriptionScore: number | null;
}

export interface ReconcilePlan {
	refresh: SyncedTransaction[];
	add: SyncedTransaction[];
	adopt: Adoption[];
	flag: Flag[];
	/** Bank rows a member kept theirs over. */
	skipped: SyncedTransaction[];
}

interface Side {
	day: number;
	cents: number;
}

interface ScoredPair extends MatchPair {
	score: DescriptionScore;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// A household row can be adopted or flagged; a retired account's bank row only
// flagged. A listed account's bank row is never a candidate.
const canAdopt = (c: MatchCandidate) => c.externalId === null;
const isRetired = (c: MatchCandidate, live: ReadonlySet<string>) =>
	c.externalId !== null &&
	c.externalAccountId !== null &&
	!live.has(c.externalAccountId);
const canFlag = (c: MatchCandidate, live: ReadonlySet<string>) =>
	canAdopt(c) || (c.heldBy === null && isRetired(c, live));
// A held row is flagged again by a same-day copy (maybe its own, so ask), or a
// Similar one while its hold isn't, since accounts sync in any order. A Similar
// hold already has its copy: a second is likely another purchase.
const clearsHold = ({ candidate, dayGap, score }: ScoredPair) =>
	candidate.heldBy === null ||
	dayGap === 0 ||
	(score.merged >= SIMILAR_SCORE && (candidate.heldScore ?? 0) < SIMILAR_SCORE);

const clearsAdoptBars = ({ word, meaning }: DescriptionScore) =>
	word >= ADOPT_WORD_SCORE &&
	meaning !== null &&
	meaning >= ADOPT_MEANING_SCORE;

/** Settles rows already saved or reviewed; the rest go on to pairing. Sorted by bank id so a retry plans the same. */
function splitIncoming(input: MatchInput) {
	const known = new Set(input.knownIds);
	const reviews = new Map(input.reviews.map((r) => [r.externalId, r]));
	const result: ReconcilePlan = {
		refresh: [],
		add: [],
		adopt: [],
		flag: [],
		skipped: [],
	};
	const unmatched: SyncedTransaction[] = [];
	const incoming = [...input.incoming].sort((a, b) =>
		byId(a.externalId, b.externalId),
	);

	for (const row of incoming) {
		const review = reviews.get(row.externalId);

		if (known.has(row.externalId)) {
			result.refresh.push(row);
		} else if (review?.status === PossibleDuplicateStatus.Pending) {
			result.flag.push({
				transactionId: review.transactionId,
				row,
				reviewId: review.id,
				descriptionScore: null,
			});
		} else if (review) {
			result.skipped.push(row);
		} else {
			unmatched.push(row);
		}
	}

	return { result, unmatched };
}

function pairUp(unmatched: SyncedTransaction[], input: MatchInput) {
	const live = new Set(input.liveAccountIds);
	const sides = new Map<SyncedTransaction | MatchCandidate, Side>();

	const side = (item: SyncedTransaction | MatchCandidate) => {
		let found = sides.get(item);

		if (!found) {
			found = {
				day: dayNumberInZone(item.date, input.timeZone),
				cents: toCents(item.amount),
			};
			sides.set(item, found);
		}

		return found;
	};

	const pairs: MatchPair[] = [];

	for (const bank of unmatched) {
		const b = side(bank);

		// A $0 row is a note (a waived fee, a loan notice, a foreign fee already in its purchase), not a Spend: pairing two is noise.
		if (b.cents === 0) continue;

		for (const candidate of input.candidates) {
			const c = side(candidate);

			// A real copy keeps its amount; a near one was always another purchase in review.
			if (b.cents !== c.cents) continue;

			const dayGap = Math.abs(b.day - c.day);

			if (dayGap > MATCH_DAYS) continue;
			// Every Adopt can also flag, so this drops only pairs that could do neither.
			if (!canFlag(candidate, live)) continue;

			pairs.push({ bank, candidate, dayGap });
		}
	}

	return pairs;
}

/**
 * Unscored pairs (same cent, inside the match window) for bank rows not yet
 * saved or reviewed. Lets the caller skip weights and embeddings when nothing pairs.
 */
export function matchPairs(input: MatchInput): MatchPair[] {
	return pairUp(splitIncoming(input).unmatched, input);
}

/**
 * Decides, per bank row: refresh a known one, refresh or skip its review, adopt
 * a same-day household row whose description clears both Adopt bars, flag a
 * close one (same cent, within 7 days), or add it. A held row a day or more
 * off is flagged only by a "Similar" pair, and only while none of its pending
 * reviews is; else the bank row is added. Pairs one-to-one, Adopts first; within
 * each, highest merged score, then nearest day, in an order fixed by the data
 * alone, so a retry gives the same plan.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
	const { result, unmatched } = splitIncoming(input);
	const pairs: ScoredPair[] = pairUp(unmatched, input)
		.map((pair) => ({
			...pair,
			score: scoreDescriptions(
				pair.bank.description,
				pair.candidate.description,
				input.weights,
				input.vectors,
			),
		}))
		.filter(clearsHold);

	const usedBanks = new Set<SyncedTransaction>();
	const usedCandidates = new Set<MatchCandidate>();

	const take = (pair: ScoredPair) => {
		if (usedBanks.has(pair.bank) || usedCandidates.has(pair.candidate)) {
			return false;
		}

		usedBanks.add(pair.bank);
		usedCandidates.add(pair.candidate);

		return true;
	};

	const exact = pairs
		.filter(
			(p) =>
				p.dayGap === 0 && canAdopt(p.candidate) && clearsAdoptBars(p.score),
		)
		.sort(
			(x, y) =>
				y.score.merged - x.score.merged ||
				byId(x.bank.externalId, y.bank.externalId) ||
				x.candidate.id - y.candidate.id,
		);

	for (const pair of exact) {
		if (take(pair)) {
			result.adopt.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				heldBy: pair.candidate.heldBy,
			});
		}
	}

	// Best description match beats nearest day: same-price subscriptions a day apart must not swap.
	const close = pairs.sort(
		(x, y) =>
			y.score.merged - x.score.merged ||
			x.dayGap - y.dayGap ||
			byId(x.bank.externalId, y.bank.externalId) ||
			x.candidate.id - y.candidate.id,
	);

	for (const pair of close) {
		if (take(pair)) {
			result.flag.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				reviewId: null,
				descriptionScore: pair.score.merged,
			});
		}
	}

	for (const bank of unmatched) {
		if (!usedBanks.has(bank)) result.add.push(bank);
	}

	result.adopt.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	result.flag.sort((x, y) => byId(x.row.externalId, y.row.externalId));

	return result;
}
