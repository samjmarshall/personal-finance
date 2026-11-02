import { LegacyOpenTelemetry } from "@ai-sdk/otel";
import { context, propagation, trace } from "@opentelemetry/api";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { embedMany, registerTelemetry } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	EMBEDDING_DIMENSIONS,
	type MatchCandidate,
	type ReconcileCounts,
	type ReconcilePlan,
	type SyncedTransaction,
	scoreDescriptions,
	wordWeights,
} from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import type {
	LogAttributes,
	Logger,
} from "~/server/observability/logging/logger";
import { unstaged } from "~/test/fakes";
import { TransactionReconcileService } from "./transaction-reconcile.service";

type ReconcileRepository = ConstructorParameters<
	typeof TransactionReconcileService
>[0]["repository"];
type LogEntry = { level: string; msg: string; attrs: LogAttributes };

const MODEL_ID = "amazon.titan-embed-text-v2:0";
// One vector for every text, so every pair's meaning score is 1.
const sameMeaning = () =>
	new MockEmbeddingModelV4({
		modelId: MODEL_ID,
		doEmbed: async ({ values }) => ({
			embeddings: values.map(() => [1, 0]),
			warnings: [],
		}),
	});
const unavailable = () =>
	new MockEmbeddingModelV4({
		modelId: MODEL_ID,
		doEmbed: async () => {
			throw new Error("Could not load credentials from any providers");
		},
	});

function serviceWith(
	staged: Partial<ReconcileRepository>,
	embeddingModel: MockEmbeddingModelV4,
) {
	const repository: ReconcileRepository = {
		findKnownExternalIds: unstaged,
		findReviews: unstaged,
		findMatchCandidates: unstaged,
		listDescriptions: unstaged,
		findEmbeddings: unstaged,
		saveEmbeddings: unstaged,
		applyReconcile: unstaged,
		...staged,
	};
	const logs: LogEntry[] = [];
	const logger: Logger = {
		debug: (msg, attrs = {}) => logs.push({ level: "debug", msg, attrs }),
		info: (msg, attrs = {}) => logs.push({ level: "info", msg, attrs }),
		warn: (msg, attrs = {}) => logs.push({ level: "warn", msg, attrs }),
		error: (msg, attrs = {}) => logs.push({ level: "error", msg, attrs }),
		with: () => logger,
	};
	const service = new TransactionReconcileService({
		repository,
		embeddingModel,
		logger,
	});
	return { service, logs };
}

describe("reconcileSynced", () => {
	const SYNCED: SyncedTransaction = {
		provenance: Provenance.Cdr,
		externalId: "txn_1",
		externalAccountId: "acct_1",
		accountName: "Everyday",
		date: new Date("2026-10-15T00:00:00.000Z"),
		description: "WOOLWORTHS",
		amount: 42.5,
	};
	const COUNTS: ReconcileCounts = {
		added: 1,
		adopted: 0,
		flagged: 0,
		known: 0,
	};
	const LIVE = { liveAccountIds: ["acct_1"] };
	// The same Sydney day as SYNCED.
	const mine = (description: string, amount = 42.5): MatchCandidate => ({
		id: 1,
		date: new Date("2026-10-14T13:00:00.000Z"),
		amount,
		description,
		externalId: null,
		externalAccountId: null,
		heldBy: null,
	});

	function reconciling(
		staged: Partial<ReconcileRepository> = {},
		model = sameMeaning(),
	) {
		const reads: unknown[][] = [];
		const plans: ReconcilePlan[] = [];
		const saves: unknown[][] = [];
		const { service, logs } = serviceWith(
			{
				findKnownExternalIds: async (...args) => {
					reads.push(["known", ...args]);
					return [];
				},
				findReviews: async (...args) => {
					reads.push(["reviews", ...args]);
					return [];
				},
				findMatchCandidates: async (...args) => {
					reads.push(["candidates", ...args]);
					return [];
				},
				listDescriptions: async () => {
					reads.push(["descriptions"]);
					return [];
				},
				findEmbeddings: async (...args) => {
					reads.push(["embeddings", ...args]);
					return [];
				},
				saveEmbeddings: async (...args) => {
					saves.push(args);
				},
				applyReconcile: async (plan) => {
					plans.push(plan);
					return COUNTS;
				},
				...staged,
			},
			model,
		);
		return { service, reads, plans, saves, logs, model };
	}

	it("reads and writes nothing for no rows", async () => {
		const { service, reads, plans } = reconciling();

		await expect(service.reconcileSynced([], LIVE)).resolves.toEqual({
			added: 0,
			adopted: 0,
			flagged: 0,
			known: 0,
		});
		expect(reads).toEqual([]);
		expect(plans).toEqual([]);
	});

	// A Sydney day starts the UTC day before, so each side gets a day of slack.
	it("reads ids, reviews and candidates over the rows' dates plus 8 and 9 days", async () => {
		const { service, reads } = reconciling();
		const older = {
			...SYNCED,
			externalId: "txn_0",
			date: new Date("2026-10-10T00:00:00.000Z"),
		};

		await service.reconcileSynced([SYNCED, older], LIVE);

		expect(reads).toEqual([
			["known", Provenance.Cdr, ["txn_1", "txn_0"]],
			["reviews", Provenance.Cdr, ["txn_1", "txn_0"]],
			[
				"candidates",
				{
					from: new Date("2026-10-02T00:00:00.000Z"),
					to: new Date("2026-10-24T00:00:00.000Z"),
					liveAccountIds: ["acct_1"],
				},
			],
		]);
	});

	it("skips reading descriptions and the model when no bank row pairs", async () => {
		const { service, reads, model } = reconciling({
			findMatchCandidates: async () => [mine("Woolworths", 42.6)],
		});

		await service.reconcileSynced([SYNCED], LIVE);

		expect(reads.map(([kind]) => kind)).not.toContain("descriptions");
		expect(reads.map(([kind]) => kind)).not.toContain("embeddings");
		expect(model.doEmbedCalls).toEqual([]);
	});

	it("adopts a same-day row whose words and meaning match", async () => {
		const { service, plans } = reconciling({
			findMatchCandidates: async () => [mine("Woolworths")],
		});

		await service.reconcileSynced([SYNCED], LIVE);

		expect(plans[0]?.adopt).toEqual([
			{ transactionId: 1, row: SYNCED, heldBy: null },
		]);
	});

	it("embeds each cache miss once and saves it under the model id", async () => {
		const { service, reads, saves, model } = reconciling({
			findMatchCandidates: async () => [mine("Woolies")],
			findEmbeddings: async (...args) => {
				reads.push(["embeddings", ...args]);
				return [{ description: "WOOLWORTHS", embedding: [1, 0] }];
			},
		});

		await service.reconcileSynced([SYNCED], LIVE);

		expect(reads).toContainEqual([
			"embeddings",
			MODEL_ID,
			["WOOLWORTHS", "WOOLIES"],
		]);
		expect(model.doEmbedCalls).toMatchObject([
			{
				values: ["WOOLIES"],
				dimensions: EMBEDDING_DIMENSIONS,
				providerOptions: {
					bedrock: { normalize: true, inputType: "clustering" },
				},
			},
		]);
		expect(saves).toEqual([
			[MODEL_ID, [{ description: "WOOLIES", embedding: [1, 0] }]],
		]);
	});

	// Postgres caps a unique index key near 2.7 KB; a pasted note must not stall the sync.
	it("never embeds or caches an overlong description", async () => {
		const { service, reads, saves, plans, model } = reconciling({
			findMatchCandidates: async () => [mine("A".repeat(501))],
		});

		await service.reconcileSynced([SYNCED], LIVE);

		expect(reads).toContainEqual(["embeddings", MODEL_ID, ["WOOLWORTHS"]]);
		expect(model.doEmbedCalls.map((call) => call.values)).toEqual([
			["WOOLWORTHS"],
		]);
		expect(saves).toEqual([
			[MODEL_ID, [{ description: "WOOLWORTHS", embedding: [1, 0] }]],
		]);
		expect(plans[0]?.flag).toHaveLength(1);
	});

	it("calls no model when every description is cached", async () => {
		const { service, plans, saves, model } = reconciling({
			findMatchCandidates: async () => [mine("Woolworths")],
			findEmbeddings: async () => [
				{ description: "WOOLWORTHS", embedding: [1, 0] },
			],
		});

		await service.reconcileSynced([SYNCED], LIVE);

		expect(model.doEmbedCalls).toEqual([]);
		expect(saves).toEqual([]);
		expect(plans[0]?.adopt).toHaveLength(1);
	});

	// No meaning score, and an Adopt needs one (adr029).
	it("warns and flags, never adopts, when the model fails", async () => {
		const { service, plans, saves, logs } = reconciling(
			{ findMatchCandidates: async () => [mine("Woolworths")] },
			unavailable(),
		);

		await service.reconcileSynced([SYNCED], LIVE);

		expect(logs).toMatchObject([
			{
				level: "warn",
				msg: "embedding unavailable",
				attrs: { error: expect.any(Error), descriptions: 1 },
			},
		]);
		expect(saves).toEqual([]);
		expect(plans).toEqual([
			{
				refresh: [],
				add: [],
				adopt: [],
				flag: [
					{
						transactionId: 1,
						row: SYNCED,
						reviewId: null,
						descriptionScore: 1,
					},
				],
				skipped: [],
			},
		]);
	});

	it("weighs words over every saved description plus the incoming ones", async () => {
		const row = { ...SYNCED, description: "WOOLWORTHS METRO" };
		const saved = ["Woolworths", "Coles"];
		// No meaning, so the saved score is the word score alone.
		const { service, plans } = reconciling(
			{
				findMatchCandidates: async () => [mine("Woolworths")],
				listDescriptions: async () => saved,
			},
			unavailable(),
		);

		await service.reconcileSynced([row], LIVE);

		const weights = wordWeights([...saved, row.description]);
		expect(plans[0]?.flag[0]?.descriptionScore).toBe(
			scoreDescriptions(row.description, "Woolworths", weights, null).merged,
		);
		// Without the incoming row, METRO is rarer and the score lower.
		expect(plans[0]?.flag[0]?.descriptionScore).not.toBe(
			scoreDescriptions(row.description, "Woolworths", wordWeights(saved), null)
				.merged,
		);
	});

	// Postgres refuses one upsert that hits the same row twice (SQLSTATE 21000).
	it("keeps only the later of two rows with the same externalId", async () => {
		const { service, plans } = reconciling();
		const later = { ...SYNCED, amount: 50 };

		await service.reconcileSynced([SYNCED, later], LIVE);

		expect(plans.map((plan) => plan.add)).toEqual([[later]]);
	});

	it("plans each provenance on its own and sums the counts", async () => {
		const { service, reads, plans } = reconciling();
		const paypal: SyncedTransaction = {
			...SYNCED,
			provenance: Provenance.Paypal,
		};

		await expect(
			service.reconcileSynced([SYNCED, paypal], LIVE),
		).resolves.toEqual({ added: 2, adopted: 0, flagged: 0, known: 0 });
		expect(reads.filter(([kind]) => kind === "known")).toEqual([
			["known", Provenance.Cdr, ["txn_1"]],
			["known", Provenance.Paypal, ["txn_1"]],
		]);
		expect(plans.map((plan) => plan.add)).toEqual([[SYNCED], [paypal]]);
	});

	describe("telemetry", () => {
		// Registered as in prod, so an ai.* span would land if one were made.
		const exporter = new InMemorySpanExporter();
		const provider = new NodeTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		beforeAll(() => {
			provider.register();
			registerTelemetry(new LegacyOpenTelemetry());
		});
		afterAll(async () => {
			await provider.shutdown();
			trace.disable();
			context.disable();
			propagation.disable();
		});

		// Proves the setup above records ai.* spans, so the next test can't pass empty.
		it("records an ai.* span for an embedding left at the default", async () => {
			await embedMany({ model: sameMeaning(), values: ["WOOLWORTHS"] });

			expect(
				exporter
					.getFinishedSpans()
					.filter(({ name }) => name.startsWith("ai.")),
			).not.toEqual([]);
			exporter.reset();
		});

		// The span processor would price an ai.* span as Claude tokens.
		it("records no ai.* span for an embedding", async () => {
			const { service, model } = reconciling({
				findMatchCandidates: async () => [mine("Woolworths")],
			});

			await service.reconcileSynced([SYNCED], LIVE);

			expect(model.doEmbedCalls).toHaveLength(1);
			expect(
				exporter
					.getFinishedSpans()
					.filter(({ name }) => name.startsWith("ai.")),
			).toEqual([]);
		});
	});
});
