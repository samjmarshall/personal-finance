import { PossibleDuplicateStatus } from "~/lib/constants";
import { dayNumberInZone, toCents } from "~/lib/utils";
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
	for (const word of descriptionWords(a)) if (words.has(word)) shared++;
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
}

/** `heldBy` is the review to release into a row once the adoption lands. */
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

interface Pair {
	bank: SyncedTransaction;
	candidate: MatchCandidate;
	dayGap: number;
	sharedWords: number;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Decides, per bank row: refresh a known one, refresh or skip its review, adopt an
 * exact household row, flag a close one (same cent, other day), or add it. Pairs
 * one-to-one, exact first; within each, most shared words, then nearest day, in an
 * order fixed by the data alone, so a retry gives the same plan.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
	const known = new Set(input.knownIds);
	const live = new Set(input.liveAccountIds);
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
		if (known.has(row.externalId)) result.refresh.push(row);
		else if (review?.status === PossibleDuplicateStatus.Pending)
			result.flag.push({
				transactionId: review.transactionId,
				row,
				reviewId: review.id,
			});
		else if (review) result.skipped.push(row);
		else unmatched.push(row);
	}

	// A household row can be adopted or flagged; a held one only adopted (the
	// exact row wins, the close one is another purchase); a retired account's
	// bank row only flagged. A listed account's bank row is never a candidate.
	const canAdopt = (c: MatchCandidate) => c.externalId === null;
	const isRetired = (c: MatchCandidate) =>
		c.externalId !== null &&
		c.externalAccountId !== null &&
		!live.has(c.externalAccountId);
	const canFlag = (c: MatchCandidate) =>
		c.heldBy === null && (canAdopt(c) || isRetired(c));

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

	const pairs: Pair[] = [];
	for (const bank of unmatched) {
		const b = side(bank);
		// A $0 row is a note (a waived fee, a loan notice), not a Spend: pairing two is noise.
		if (b.cents === 0) continue;
		for (const candidate of input.candidates) {
			if (!canAdopt(candidate) && !canFlag(candidate)) continue;
			const c = side(candidate);
			// A real copy keeps its amount; a near one was always another purchase in review.
			if (b.cents !== c.cents) continue;
			const dayGap = Math.abs(b.day - c.day);
			if (dayGap > MATCH_DAYS) continue;
			pairs.push({
				bank,
				candidate,
				dayGap,
				sharedWords: sharedWords(bank.description, candidate.description),
			});
		}
	}

	const usedBanks = new Set<SyncedTransaction>();
	const usedCandidates = new Set<MatchCandidate>();
	const take = (pair: Pair) => {
		if (usedBanks.has(pair.bank) || usedCandidates.has(pair.candidate))
			return false;
		usedBanks.add(pair.bank);
		usedCandidates.add(pair.candidate);
		return true;
	};

	// Words before days: two same-priced subscriptions a day apart must not cross.
	const exact = pairs
		.filter((p) => p.dayGap === 0 && canAdopt(p.candidate))
		.sort(
			(x, y) =>
				y.sharedWords - x.sharedWords ||
				byId(x.bank.externalId, y.bank.externalId) ||
				x.candidate.id - y.candidate.id,
		);
	for (const pair of exact) {
		if (take(pair))
			result.adopt.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				heldBy: pair.candidate.heldBy,
			});
	}

	const close = pairs
		.filter((p) => canFlag(p.candidate))
		.sort(
			(x, y) =>
				y.sharedWords - x.sharedWords ||
				x.dayGap - y.dayGap ||
				byId(x.bank.externalId, y.bank.externalId) ||
				x.candidate.id - y.candidate.id,
		);
	for (const pair of close) {
		if (take(pair))
			result.flag.push({
				transactionId: pair.candidate.id,
				row: pair.bank,
				reviewId: null,
			});
	}

	for (const bank of unmatched) if (!usedBanks.has(bank)) result.add.push(bank);
	result.adopt.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	result.flag.sort((x, y) => byId(x.row.externalId, y.row.externalId));
	return result;
}
