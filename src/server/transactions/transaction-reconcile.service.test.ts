import { describe, expect, it } from "vitest";
import type {
	ReconcileCounts,
	ReconcilePlan,
	SyncedTransaction,
} from "~/domain/transactions";
import { Provenance } from "~/lib/constants";
import { unstaged } from "~/test/fakes";
import { TransactionReconcileService } from "./transaction-reconcile.service";

type ReconcileRepository = ConstructorParameters<
	typeof TransactionReconcileService
>[0]["repository"];

function serviceWith(staged: Partial<ReconcileRepository>) {
	const repository: ReconcileRepository = {
		findKnownExternalIds: unstaged,
		findReviews: unstaged,
		findMatchCandidates: unstaged,
		applyReconcile: unstaged,
		...staged,
	};
	return new TransactionReconcileService({ repository });
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

	function reconciling(staged: Partial<ReconcileRepository> = {}) {
		const reads: unknown[][] = [];
		const plans: ReconcilePlan[] = [];
		const service = serviceWith({
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
			applyReconcile: async (plan) => {
				plans.push(plan);
				return COUNTS;
			},
			...staged,
		});
		return { service, reads, plans };
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

	it("adopts a household row on the same Sydney day and cent", async () => {
		const { service, plans } = reconciling({
			findMatchCandidates: async () => [
				{
					id: 1,
					date: new Date("2026-10-14T13:00:00.000Z"),
					amount: 42.5,
					description: "Coffee",
					externalId: null,
					externalAccountId: null,
					heldBy: null,
				},
			],
		});

		await expect(service.reconcileSynced([SYNCED], LIVE)).resolves.toEqual(
			COUNTS,
		);
		expect(plans).toEqual([
			{
				refresh: [],
				add: [],
				adopt: [{ transactionId: 1, row: SYNCED, heldBy: null }],
				flag: [],
				skipped: [],
			},
		]);
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
});
