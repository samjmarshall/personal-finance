import { type EmbeddingModel, embedMany } from "ai";
import {
	cleanDescription,
	EMBEDDING_DIMENSIONS,
	MATCH_DAYS,
	type MatchPair,
	matchPairs,
	planReconcile,
	type ReconcileCounts,
	type SyncedTransaction,
	type WordWeights,
	wordWeights,
} from "~/domain/transactions";
import { HOUSEHOLD_TIME_ZONE } from "~/lib/constants";
import type { Logger } from "~/server/observability/logging/logger";
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
// One time budget for the whole batch: a big first import makes one model call per text.
const EMBED_TIMEOUT_MS = 30_000;
// The cache's unique index refuses a key over ~2.7 KB, and that failed save would
// fail the sync. 500 characters is at most 1.5 KB.
const MAX_EMBED_LENGTH = 500;
// Saved as each lands, so a failed or slow call keeps the vectors before it.
const EMBED_BATCH_SIZE = 32;

type ReconcileRepository = Pick<
	TransactionsRepository,
	| "findKnownExternalIds"
	| "findReviews"
	| "findMatchCandidates"
	| "listDescriptions"
	| "findEmbeddings"
	| "saveEmbeddings"
	| "applyReconcile"
>;

// Its own service because only the bank sync worker reconciles (service split rule).
interface TransactionReconcileServiceDeps {
	repository: ReconcileRepository;
	/** Its `modelId` keys the embedding cache. */
	embeddingModel: Exclude<EmbeddingModel, string>;
	logger: Logger;
}

export class TransactionReconcileService {
	private readonly repository: ReconcileRepository;
	private readonly embeddingModel: Exclude<EmbeddingModel, string>;
	private readonly logger: Logger;

	constructor({
		repository,
		embeddingModel,
		logger,
	}: TransactionReconcileServiceDeps) {
		this.repository = repository;
		this.embeddingModel = embeddingModel;
		this.logger = logger;
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
		// Every description is a big read and each embedding a model call, both
		// wasted when nothing pairs.
		const pairs = matchPairs(match);
		const [weights, vectors] = pairs.length
			? await Promise.all([this.weightsFor(incoming), this.vectorsFor(pairs)])
			: [NO_WEIGHTS, null];
		return this.repository.applyReconcile(
			planReconcile({ ...match, weights, vectors }),
		);
	}

	private async weightsFor(
		incoming: SyncedTransaction[],
	): Promise<WordWeights> {
		const saved = await this.repository.listDescriptions();
		return wordWeights([...saved, ...incoming.map((row) => row.description)]);
	}

	/** Keyed by cleaned text. Overlong text and a failed model call's misses are left out, so they never Adopt. */
	private async vectorsFor(pairs: MatchPair[]): Promise<Map<string, number[]>> {
		const texts = new Set(
			pairs
				.flatMap(({ bank, candidate }) => [
					cleanDescription(bank.description),
					cleanDescription(candidate.description),
				])
				.filter((text) => text && text.length <= MAX_EMBED_LENGTH),
		);
		const model = this.embeddingModel.modelId;
		const cached = await this.repository.findEmbeddings(model, [...texts]);
		const vectors = new Map(
			cached.map(({ description, embedding }) => [description, embedding]),
		);
		const misses = [...texts].filter((text) => !vectors.has(text));
		if (!misses.length) return vectors;

		const abortSignal = AbortSignal.timeout(EMBED_TIMEOUT_MS);
		for (let start = 0; start < misses.length; start += EMBED_BATCH_SIZE) {
			const batch = misses.slice(start, start + EMBED_BATCH_SIZE);
			let embeddings: number[][];
			try {
				({ embeddings } = await embedMany({
					model: this.embeddingModel,
					values: batch,
					dimensions: EMBEDDING_DIMENSIONS,
					maxRetries: 2,
					maxParallelCalls: 4,
					abortSignal,
					// Titan reads `normalize`, Cohere `inputType`; each ignores the other.
					providerOptions: {
						bedrock: { normalize: true, inputType: "clustering" },
					},
					// The span processor would price an ai.* span as Claude tokens.
					telemetry: { isEnabled: false },
				}));
			} catch (error) {
				// Words alone still score and flag. A pair flagged now stays a review: no later sync rescores it.
				this.logger.warn("embedding unavailable", {
					error,
					descriptions: misses.length - start,
				});
				return vectors;
			}
			// embedMany keeps input order and length.
			const fresh = batch.map((description, i) => ({
				description,
				embedding: embeddings[i] as number[],
			}));
			await this.repository.saveEmbeddings(model, fresh);
			for (const { description, embedding } of fresh)
				vectors.set(description, embedding);
		}
		return vectors;
	}
}
