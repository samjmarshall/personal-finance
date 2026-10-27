import { describe, expect, it } from "vitest";
import { PossibleDuplicateStatus, Provenance } from "~/lib/constants";
import {
	type MatchCandidate,
	planReconcile,
	type ReconcileInput,
	type ReconcileReview,
} from "./reconcile-synced";
import type { SyncedTransaction } from "./transaction.interface";

const ZONE = "Australia/Sydney";

// A bank row is saved at UTC midnight of its day.
function bank(
	externalId: string,
	day: string,
	amount: number,
	externalAccountId = "acct_live",
): SyncedTransaction {
	return {
		provenance: Provenance.Cdr,
		externalId,
		externalAccountId,
		accountName: "Everyday",
		amount,
		date: new Date(`${day}T00:00:00.000Z`),
		description: `BANK ${externalId}`,
	};
}

// A typed row is saved at Sydney midnight: 13:00 UTC the day before (AEDT).
function mine(
	id: number,
	day: string,
	amount: number,
	extra: Partial<MatchCandidate> = {},
): MatchCandidate {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCHours(-11);
	return {
		id,
		date,
		amount,
		externalId: null,
		externalAccountId: null,
		heldBy: null,
		...extra,
	};
}

function plan(input: Partial<ReconcileInput>) {
	return planReconcile({
		incoming: [],
		knownIds: [],
		reviews: [],
		candidates: [],
		liveAccountIds: ["acct_live"],
		timeZone: ZONE,
		...input,
	});
}

function review(
	externalId: string,
	status: PossibleDuplicateStatus,
	transactionId = 1,
): ReconcileReview {
	return { id: 90, externalId, status, transactionId };
}

const EMPTY = { refresh: [], add: [], adopt: [], flag: [], skipped: [] };

describe("planReconcile", () => {
	it("refreshes a known bank id and never matches it", () => {
		const row = bank("t1", "2026-11-10", 5);
		expect(
			plan({
				incoming: [row],
				knownIds: ["t1"],
				candidates: [mine(1, "2026-11-10", 5)],
			}),
		).toEqual({ ...EMPTY, refresh: [row] });
	});

	it("adopts a household row with the same Sydney day and cent", () => {
		const row = bank("t1", "2026-11-10", 12.3);
		expect(
			plan({ incoming: [row], candidates: [mine(1, "2026-11-10", 12.3)] }),
		).toEqual({ ...EMPTY, adopt: [{ transactionId: 1, row, heldBy: null }] });
	});

	it("compares amounts as whole cents", () => {
		const row = bank("t1", "2026-11-10", 0.3);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-10", 0.1 + 0.2)],
		});
		expect(result.adopt).toHaveLength(1);
	});

	it.each([
		["3 days and 4% off", "2026-11-13", 104, "flag"],
		["7 days and exactly 5% off", "2026-11-17", 105, "flag"],
		["8 days off", "2026-11-18", 100, "add"],
		["6% off", "2026-11-10", 106, "add"],
		["the opposite sign", "2026-11-10", -100, "add"],
	])("with %s it does a %s", (_, day, amount, outcome) => {
		const row = bank("t1", day, amount);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-10", 100)],
		});
		if (outcome === "flag") {
			expect(result).toEqual({
				...EMPTY,
				flag: [{ transactionId: 1, row, reviewId: null }],
			});
		} else {
			expect(result).toEqual({ ...EMPTY, add: [row] });
		}
	});

	it("uses a candidate once; the other bank row is added", () => {
		const first = bank("t1", "2026-11-10", 5);
		const second = bank("t2", "2026-11-10", 5);
		expect(
			plan({
				incoming: [first, second],
				candidates: [mine(1, "2026-11-10", 5)],
			}),
		).toEqual({
			...EMPTY,
			adopt: [{ transactionId: 1, row: first, heldBy: null }],
			add: [second],
		});
	});

	it("pairs an exact bank row before a near one sorted ahead of it", () => {
		const near = bank("a_near", "2026-11-10", 5.1);
		const exact = bank("b_exact", "2026-11-10", 5);
		expect(
			plan({ incoming: [near, exact], candidates: [mine(1, "2026-11-10", 5)] }),
		).toEqual({
			...EMPTY,
			adopt: [{ transactionId: 1, row: exact, heldBy: null }],
			add: [near],
		});
	});

	it("pairs the closest day first among near pairs", () => {
		const row = bank("t1", "2026-11-10", 100);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-14", 101), mine(2, "2026-11-11", 103)],
		});
		expect(result.flag).toEqual([{ transactionId: 2, row, reviewId: null }]);
	});

	it("refreshes a pending review instead of matching its bank row again", () => {
		const row = bank("t1", "2026-11-10", 5);
		expect(
			plan({
				incoming: [row],
				reviews: [review("t1", PossibleDuplicateStatus.Pending, 7)],
				candidates: [mine(1, "2026-11-10", 5)],
			}),
		).toEqual({ ...EMPTY, flag: [{ transactionId: 7, row, reviewId: 90 }] });
	});

	it("skips a bank row the member kept theirs over", () => {
		const row = bank("t1", "2026-11-10", 5);
		expect(
			plan({
				incoming: [row],
				reviews: [review("t1", PossibleDuplicateStatus.Kept)],
				candidates: [mine(1, "2026-11-10", 5)],
			}),
		).toEqual({ ...EMPTY, skipped: [row] });
	});

	it("lets an exact bank row adopt a held row and release its review", () => {
		const row = bank("t1", "2026-11-10", 5);
		expect(
			plan({
				incoming: [row],
				candidates: [mine(1, "2026-11-10", 5, { heldBy: 90 })],
			}),
		).toEqual({ ...EMPTY, adopt: [{ transactionId: 1, row, heldBy: 90 }] });
	});

	it("never flags a held row a second time", () => {
		const row = bank("t1", "2026-11-11", 5.1);
		expect(
			plan({
				incoming: [row],
				candidates: [mine(1, "2026-11-10", 5, { heldBy: 90 })],
			}),
		).toEqual({ ...EMPTY, add: [row] });
	});

	it("flags, never adopts, an exact row from an account RedBark dropped", () => {
		const row = bank("t_new", "2026-11-10", 5);
		const retired = mine(1, "2026-11-10", 5, {
			externalId: "t_old",
			externalAccountId: "acct_gone",
		});
		expect(plan({ incoming: [row], candidates: [retired] })).toEqual({
			...EMPTY,
			flag: [{ transactionId: 1, row, reviewId: null }],
		});
	});

	it("never matches a bank row from a listed account", () => {
		const row = bank("t2", "2026-11-10", 5);
		const listed = mine(1, "2026-11-10", 5, {
			externalId: "t1",
			externalAccountId: "acct_live",
		});
		expect(plan({ incoming: [row], candidates: [listed] })).toEqual({
			...EMPTY,
			add: [row],
		});
	});

	it("adopts the lower id of two exact candidates", () => {
		const row = bank("t1", "2026-11-10", 5);
		const result = plan({
			incoming: [row],
			candidates: [mine(9, "2026-11-10", 5), mine(3, "2026-11-10", 5)],
		});
		expect(result.adopt).toEqual([{ transactionId: 3, row, heldBy: null }]);
	});

	it("gives the same plan for the same input, in any order", () => {
		const rows = [
			bank("t3", "2026-11-12", 20),
			bank("t1", "2026-11-10", 5),
			bank("t2", "2026-11-10", 5),
			bank("t4", "2026-11-11", 40),
		];
		const candidates = [
			mine(2, "2026-11-10", 5),
			mine(1, "2026-11-10", 5),
			mine(3, "2026-11-13", 20.5),
		];
		const once = plan({ incoming: rows, candidates });
		expect(plan({ incoming: rows, candidates })).toEqual(once);
		expect(
			plan({
				incoming: [...rows].reverse(),
				candidates: [...candidates].reverse(),
			}),
		).toEqual(once);
		expect(once.adopt.map((a) => [a.row.externalId, a.transactionId])).toEqual([
			["t1", 1],
			["t2", 2],
		]);
	});
});
