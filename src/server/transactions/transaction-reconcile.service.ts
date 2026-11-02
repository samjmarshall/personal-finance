import {
	MATCH_DAYS,
	matchPairs,
	planReconcile,
	type ReconcileCounts,
	type SyncedTransaction,
	wordWeights,
} from "~/domain/transactions";
import { HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import type { TransactionsRepository } from "./transactions.repository";

const MS_PER_DAY = 86_400_000;
// A Sydney day starts the UTC day before: scan a day wider each side, +1 more
// at the end because it is exclusive. The planner keeps the exact window.
const SCAN_BEFORE_DAYS = MATCH_DAYS + 1;
const SCAN_AFTER_DAYS = MATCH_DAYS + 2;

const NO_COUNTS: ReconcileCounts = {
	added: 0,
	adopted: 0,
	flagged: 0,
	known: 0,
};
const sumCounts = (a: ReconcileCounts, b: ReconcileCounts) => ({
	added: a.added + b.added,
	adopted: a.adopted + b.adopted,
	flagged: a.flagged + b.flagged,
	known: a.known + b.known,
});
const NO_WEIGHTS = wordWeights([]);

type ReconcileRepository = Pick<
	TransactionsRepository,
	| "findKnownExternalIds"
	| "findReviews"
	| "findMatchCandidates"
	| "listDescriptions"
	| "applyReconcile"
>;

// Its own service because only the bank sync worker reconciles (service split rule).
interface TransactionReconcileServiceDeps {
	repository: ReconcileRepository;
}

export class TransactionReconcileService {
	private readonly repository: ReconcileRepository;

	constructor({ repository }: TransactionReconcileServiceDeps) {
		this.repository = repository;
	}

	// A page that shifts mid-fetch can repeat a row, and Postgres refuses one
	// upsert that hits the same row twice (SQLSTATE 21000). The later copy wins.
	// A bank id is unique only within its provenance, so each is planned alone.
	async reconcileSynced(
		rows: SyncedTransaction[],
		{ liveAccountIds }: { liveAccountIds: string[] },
	): Promise<ReconcileCounts> {
		const byProvenance = new Map<
			SyncedTransaction["provenance"],
			Map<string, SyncedTransaction>
		>();
		for (const row of rows) {
			const group = byProvenance.get(row.provenance) ?? new Map();
			byProvenance.set(row.provenance, group.set(row.externalId, row));
		}
		let counts = NO_COUNTS;
		for (const [provenance, group] of byProvenance) {
			const result = await this.reconcileGroup(
				provenance,
				[...group.values()],
				liveAccountIds,
			);
			counts = sumCounts(counts, result);
		}
		return counts;
	}

	/** `incoming`: all of `provenance`, unique by bank id, not empty. */
	private async reconcileGroup(
		provenance: SyncedTransaction["provenance"],
		incoming: SyncedTransaction[],
		liveAccountIds: string[],
	): Promise<ReconcileCounts> {
		const ids = incoming.map((row) => row.externalId);
		const times = incoming.map((row) => row.date.getTime());
		const [knownIds, reviews, candidates] = await Promise.all([
			this.repository.findKnownExternalIds(provenance, ids),
			this.repository.findReviews(provenance, ids),
			this.repository.findMatchCandidates({
				from: new Date(Math.min(...times) - SCAN_BEFORE_DAYS * MS_PER_DAY),
				to: new Date(Math.max(...times) + SCAN_AFTER_DAYS * MS_PER_DAY),
				liveAccountIds,
			}),
		]);
		const match = {
			incoming,
			knownIds,
			reviews,
			candidates,
			liveAccountIds,
			timeZone: HOUSEHOLD_TIME_ZONE,
		};
		// Every description is a big read, wasted when nothing pairs.
		const weights = matchPairs(match).length
			? wordWeights([
					...(await this.repository.listDescriptions()),
					...incoming.map((row) => row.description),
				])
			: NO_WEIGHTS;
		return this.repository.applyReconcile(
			planReconcile({ ...match, weights, vectors: null }),
		);
	}
}
