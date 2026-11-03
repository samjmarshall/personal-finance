import { describe, expect, it } from "vitest";
import { PossibleDuplicateStatus, Provenance } from "~/lib/constants";
import {
	cleanDescription,
	scoreDescriptions,
	wordWeights,
} from "./description-score";
import {
	descriptionWords,
	type MatchCandidate,
	matchPairs,
	planReconcile,
	type ReconcileInput,
	type ReconcileReview,
	sharedWords,
} from "./reconcile-synced";
import type { SyncedTransaction } from "./transaction.interface";

const ZONE = "Australia/Sydney";

// One merchant on both sides, so a pair clears the Adopt bars unless a test
// gives it other words or meaning.
const CAFE = "BEAN THERE CAFE";

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
		description: CAFE,
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
		description: CAFE,
		externalId: null,
		externalAccountId: null,
		heldBy: null,
		...extra,
	};
}

// Every text means the same, so only the words tell pairs apart.
const sameMeaning = (texts: string[]) =>
	new Map(texts.map((text) => [cleanDescription(text), [1]]));

function plan(input: Partial<ReconcileInput>) {
	const texts = [...(input.incoming ?? []), ...(input.candidates ?? [])].map(
		(row) => row.description,
	);

	return planReconcile({
		incoming: [],
		knownIds: [],
		reviews: [],
		candidates: [],
		liveAccountIds: ["acct_live"],
		timeZone: ZONE,
		weights: wordWeights(texts),
		vectors: sameMeaning(texts),
		...input,
	});
}

// Its exact score is pinned once, by "gives a new flag its merged score".
const newFlag = (transactionId: number, row: SyncedTransaction) => ({
	transactionId,
	row,
	reviewId: null,
	descriptionScore: expect.any(Number),
});

function review(
	externalId: string,
	status: PossibleDuplicateStatus,
	transactionId = 1,
): ReconcileReview {
	return { id: 90, externalId, status, transactionId };
}

const EMPTY = { refresh: [], add: [], adopt: [], flag: [], skipped: [] };

describe("sharedWords", () => {
	it("counts distinct words both share", () => {
		expect(
			sharedWords(
				"PAYPAL *NETFLIX AUS AUS",
				"PAYPAL *NETFLIX AUS 4029357733 AUS",
			),
		).toBe(3);
	});

	it("ignores case and splits on anything but letters and digits", () => {
		expect([...descriptionWords("Transfer To Sam, *SPOTIFY*P3E65F")]).toEqual([
			"TRANSFER",
			"TO",
			"SAM",
			"SPOTIFY",
			"P3E65F",
		]);
		expect(sharedWords("99 Bikes - Lawnton", "CommBank App 99 BIKES")).toBe(2);
	});
});

// Two subscriptions at one price, yours a day after the bank's (as seen on import).
const NETFLIX_BANK = {
	...bank("a_netflix", "2026-01-13", 20.99),
	description: "PAYPAL *NETFLIX AUS 4029357733 AUS",
};
const SPOTIFY_BANK = {
	...bank("b_spotify", "2026-01-13", 20.99),
	description: "PAYPAL *SPOTIFY*P3E65F 4029357733 AUS",
};

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

	it("adopts a household row with the same Sydney day, cent and description", () => {
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
		["3 days off", "2026-11-13", 100, "flag"],
		["7 days off", "2026-11-17", 100, "flag"],
		["8 days off", "2026-11-18", 100, "add"],
		["1 cent off on the day", "2026-11-10", 100.01, "add"],
		["1 cent off 3 days later", "2026-11-13", 99.99, "add"],
		["the opposite sign", "2026-11-10", -100, "add"],
	])("with %s it does a %s", (_, day, amount, outcome) => {
		const row = bank("t1", day, amount);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-10", 100)],
		});

		if (outcome === "flag") {
			expect(result).toEqual({ ...EMPTY, flag: [newFlag(1, row)] });
		} else {
			expect(result).toEqual({ ...EMPTY, add: [row] });
		}
	});

	it("never pairs a $0 bank row with a $0 one; it is added", () => {
		const row = bank("t1", "2026-11-10", 0);
		expect(
			plan({ incoming: [row], candidates: [mine(1, "2026-11-10", 0)] }),
		).toEqual({ ...EMPTY, add: [row] });
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

	it("flags a same-amount row days off, never a near amount on the day", () => {
		const row = bank("t1", "2026-11-10", 30);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-10", 29.5), mine(2, "2026-11-13", 30)],
		});
		expect(result.flag).toEqual([newFlag(2, row)]);
	});

	it("pairs the closest day first among same-amount pairs", () => {
		const row = bank("t1", "2026-11-10", 100);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-14", 100), mine(2, "2026-11-11", 100)],
		});
		expect(result.flag).toEqual([newFlag(2, row)]);
	});

	it("pairs the highest merged score first, so same-priced rows never cross", () => {
		const result = plan({
			incoming: [NETFLIX_BANK, SPOTIFY_BANK],
			candidates: [
				mine(1, "2026-01-14", 20.99, {
					description: "PAYPAL *SPOTIFY*P3E65F AUS",
				}),
				mine(2, "2026-01-14", 20.99, {
					description: "PAYPAL *NETFLIX AUS AUS",
				}),
			],
		});
		expect(result.flag).toEqual([
			newFlag(2, NETFLIX_BANK),
			newFlag(1, SPOTIFY_BANK),
		]);
	});

	it("adopts each bank row into the same-day row it matches", () => {
		const result = plan({
			incoming: [NETFLIX_BANK, SPOTIFY_BANK],
			candidates: [
				mine(1, "2026-01-13", 20.99, {
					description: "PAYPAL *SPOTIFY*P3E65F AUS",
				}),
				mine(2, "2026-01-13", 20.99, {
					description: "PAYPAL *NETFLIX AUS AUS",
				}),
			],
		});
		expect(result.adopt).toEqual([
			{ transactionId: 2, row: NETFLIX_BANK, heldBy: null },
			{ transactionId: 1, row: SPOTIFY_BANK, heldBy: null },
		]);
	});

	it("flags, never adopts, the crossed Netflix and Spotify on one day", () => {
		const result = plan({
			incoming: [NETFLIX_BANK],
			candidates: [
				mine(1, "2026-01-13", 20.99, {
					description: "PAYPAL *SPOTIFY*P40603 AUS",
				}),
			],
			vectors: new Map([
				["NETFLIX", [1, 0]],
				["SPOTIFY", [0, 1]],
			]),
		});
		expect(result).toEqual({ ...EMPTY, flag: [newFlag(1, NETFLIX_BANK)] });
	});

	it("puts a typed name before a nearer-day stranger", () => {
		const row = { ...NETFLIX_BANK, description: "NETFLIX.COM SYDNEY AUS" };
		const result = plan({
			incoming: [row],
			candidates: [
				mine(1, "2026-01-14", 20.99, { description: "Groceries" }),
				mine(2, "2026-01-19", 20.99, { description: "Netflix" }),
			],
		});
		expect(result.flag).toEqual([newFlag(2, row)]);
	});

	describe("on the same day", () => {
		const row = {
			...bank("t1", "2026-11-10", 5),
			description: "SQ *BEAN THERE CAFE",
		};
		const typed = (description: string) =>
			mine(1, "2026-11-10", 5, { description });
		const vectors = (typedVector: number[]) =>
			new Map([
				["BEAN THERE CAFE", [1, 0]],
				["BEAN THERE CAFE BRISBANE", typedVector],
				["COFFEE", typedVector],
			]);

		it("adopts when both the words and the meaning match", () => {
			const result = plan({
				incoming: [row],
				candidates: [typed("Bean There Cafe Brisbane")],
				vectors: vectors([1, 0.1]),
			});
			expect(result).toEqual({
				...EMPTY,
				adopt: [{ transactionId: 1, row, heldBy: null }],
			});
		});

		it.each([
			["the meaning falls short", "Bean There Cafe Brisbane", vectors([0, 1])],
			["the words fall short", "Coffee", vectors([1, 0])],
			["there is no meaning score", "Bean There Cafe", null],
		])("flags when %s", (_, description, vectorMap) => {
			const result = plan({
				incoming: [row],
				candidates: [typed(description)],
				vectors: vectorMap,
			});
			expect(result).toEqual({ ...EMPTY, flag: [newFlag(1, row)] });
		});

		it("flags a held row's same-day pair that falls short", () => {
			const held = mine(1, "2026-11-10", 5, {
				heldBy: 90,
				description: "Groceries",
			});
			expect(plan({ incoming: [row], candidates: [held] })).toEqual({
				...EMPTY,
				flag: [newFlag(1, row)],
			});
		});
	});

	it("gives a new flag its merged score", () => {
		const row = {
			...bank("t1", "2026-11-10", 5),
			description: "NETFLIX.COM SYDNEY AUS",
		};
		const weights = wordWeights([row.description, "Netflix", "COLES SYDNEY"]);
		const vectors = new Map([
			["NETFLIX COM SYDNEY", [1, 0]],
			["NETFLIX", [1, 1]],
		]);
		const result = plan({
			incoming: [row],
			candidates: [mine(1, "2026-11-12", 5, { description: "Netflix" })],
			weights,
			vectors,
		});
		expect(result.flag).toEqual([
			{
				transactionId: 1,
				row,
				reviewId: null,
				descriptionScore: scoreDescriptions(
					row.description,
					"Netflix",
					weights,
					vectors,
				).merged,
			},
		]);
	});

	it("refreshes a pending review instead of matching its bank row again", () => {
		const row = bank("t1", "2026-11-10", 5);
		expect(
			plan({
				incoming: [row],
				reviews: [review("t1", PossibleDuplicateStatus.Pending, 7)],
				candidates: [mine(1, "2026-11-10", 5)],
			}),
		).toEqual({
			...EMPTY,
			flag: [{ transactionId: 7, row, reviewId: 90, descriptionScore: null }],
		});
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
		const row = bank("t1", "2026-11-11", 5);
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
			flag: [newFlag(1, row)],
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

describe("matchPairs", () => {
	it("pairs only unsaved, unreviewed bank rows, by cent within 7 days", () => {
		const fresh = bank("t1", "2026-11-10", 5);
		const candidate = mine(1, "2026-11-12", 5);
		expect(
			matchPairs({
				incoming: [
					fresh,
					bank("t_known", "2026-11-10", 5),
					bank("t_reviewed", "2026-11-10", 5),
					bank("t_far", "2026-11-20", 5),
				],
				knownIds: ["t_known"],
				reviews: [review("t_reviewed", PossibleDuplicateStatus.Pending)],
				candidates: [candidate],
				liveAccountIds: ["acct_live"],
				timeZone: ZONE,
			}),
		).toEqual([{ bank: fresh, candidate, dayGap: 2 }]);
	});

	// Each pair costs an embedding, and a held row a day off can be neither adopted nor flagged.
	it("skips a held row unless the bank row is on its day", () => {
		const held = mine(1, "2026-11-10", 5, { heldBy: 90 });
		const sameDay = bank("t1", "2026-11-10", 5);
		expect(
			matchPairs({
				incoming: [sameDay, bank("t2", "2026-11-11", 5)],
				knownIds: [],
				reviews: [],
				candidates: [held],
				liveAccountIds: ["acct_live"],
				timeZone: ZONE,
			}),
		).toEqual([{ bank: sameDay, candidate: held, dayGap: 0 }]);
	});
});
