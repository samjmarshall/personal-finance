import { describe, expect, it } from "vitest";
import {
	cleanDescription,
	meaningScore,
	mergedScore,
	scoreDescriptions,
	wordScore,
	wordWeights,
} from "./description-score";

describe("cleanDescription", () => {
	it.each([
		["PAYPAL *NETFLIX AUS 4029357733 AUS", "NETFLIX"],
		["PAYPAL *SPOTIFY*P40603 AUS", "SPOTIFY"],
		["NETFLIX.COM SYDNEY AUS", "NETFLIX COM SYDNEY"],
		["SQ *BEAN THERE CAFE", "BEAN THERE CAFE"],
		["DBS*KC Sandgate Pty Lt Sandgate AUS", "KC SANDGATE PTY LT"],
		["Pin* imedical Pyrmont AUS", "IMEDICAL PYRMONT"],
		["SMP*EW Cosmetic Injec9 Lawnton AUS", "EW COSMETIC INJEC9 LAWNTON"],
		["BWS 2923 BRIGHTON QL AUS", "BWS BRIGHTON"],
		["TRANSLINK TICKETING QLD AUS", "TRANSLINK TICKETING"],
		[
			"WESTFIELD CHERMSIDE CHERMSIDE AUS, Card xx6857, Value date: 03/07/2026",
			"WESTFIELD CHERMSIDE",
		],
		["VERCEL COVINA USA FRGN AMT: 20.00  U. S. DOLLAR", "VERCEL COVINA USA"],
	])("cleans %s to %s", (raw, cleaned) => {
		expect(cleanDescription(raw)).toBe(cleaned);
	});

	it("strips a processor only when it starts the text and a * follows", () => {
		expect(cleanDescription("SPOTIFY")).toBe("SPOTIFY");
		expect(cleanDescription("SP CAFE")).toBe("SP CAFE");
		expect(cleanDescription("sp *cafe")).toBe("CAFE");
	});

	it("keeps a number shorter than 3 digits", () => {
		expect(cleanDescription("99 BIKES")).toBe("99 BIKES");
	});

	it("uppercases and keeps each word once, in order", () => {
		expect(cleanDescription("Netflix")).toBe("NETFLIX");
		expect(cleanDescription("cafe bean CAFE")).toBe("CAFE BEAN");
	});

	it("gives an empty string when every word is noise", () => {
		expect(cleanDescription("PAYPAL *AUS 1234 AU")).toBe("");
	});
});

describe("wordScore", () => {
	const weights = wordWeights([
		"NETFLIX.COM SYDNEY",
		"WOOLWORTHS SYDNEY",
		"COLES SYDNEY",
		"KMART SYDNEY",
		"BUNNINGS SYDNEY",
	]);

	it("scores identical text 1 and disjoint text 0", () => {
		expect(wordScore("NETFLIX SYDNEY", "NETFLIX SYDNEY", weights)).toBeCloseTo(
			1,
		);
		expect(wordScore("NETFLIX", "SPOTIFY", weights)).toBe(0);
	});

	it("is symmetric", () => {
		expect(wordScore("NETFLIX COM SYDNEY", "NETFLIX", weights)).toBe(
			wordScore("NETFLIX", "NETFLIX COM SYDNEY", weights),
		);
	});

	it("scores an empty side 0", () => {
		expect(wordScore("", "NETFLIX", weights)).toBe(0);
		expect(wordScore("", "", weights)).toBe(0);
	});

	it("weighs a rare shared word above a common one", () => {
		expect(
			wordScore("NETFLIX SYDNEY", "NETFLIX MELBOURNE", weights),
		).toBeGreaterThan(
			wordScore("NETFLIX SYDNEY", "WOOLWORTHS SYDNEY", weights),
		);
	});

	it("counts each distinct cleaned description once", () => {
		const weekly = wordWeights([
			"WOOLWORTHS SYDNEY",
			"Woolworths Sydney",
			"WOOLWORTHS SYDNEY AUS",
			"COLES SYDNEY",
		]);
		expect(weekly).toEqual(wordWeights(["WOOLWORTHS SYDNEY", "COLES SYDNEY"]));
	});

	it("scores the crossed subscriptions 0", () => {
		const crossed = [
			cleanDescription("PAYPAL *NETFLIX AUS"),
			cleanDescription("PAYPAL *SPOTIFY*P40603 AUS"),
		] as const;
		expect(crossed).toEqual(["NETFLIX", "SPOTIFY"]);
		expect(wordScore(...crossed, wordWeights(crossed))).toBe(0);
	});
});

describe("meaningScore", () => {
	it("scores the same direction 1", () => {
		expect(meaningScore([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
	});

	it("scores orthogonal and opposite vectors 0", () => {
		expect(meaningScore([1, 0], [0, 1])).toBe(0);
		expect(meaningScore([1, 2], [-1, -2])).toBe(0);
	});
});

describe("mergedScore", () => {
	it("is the word score when there is no meaning score", () => {
		expect(mergedScore(0.4, null)).toBe(0.4);
	});

	it("is the mean of both scores otherwise", () => {
		expect(mergedScore(0.4, 0.8)).toBeCloseTo(0.6);
	});
});

describe("scoreDescriptions", () => {
	const weights = wordWeights(["NETFLIX.COM SYDNEY AUS", "Netflix", "Woolies"]);
	const vectors = new Map([
		["NETFLIX COM SYDNEY", [1, 0]],
		["NETFLIX", [1, 1]],
	]);

	it("scores the cleaned texts, meaning from their vectors", () => {
		const score = scoreDescriptions(
			"NETFLIX.COM SYDNEY AUS",
			"Netflix",
			weights,
			vectors,
		);
		const word = wordScore("NETFLIX COM SYDNEY", "NETFLIX", weights);
		expect(score).toEqual({
			word,
			meaning: meaningScore([1, 0], [1, 1]),
			merged: mergedScore(word, meaningScore([1, 0], [1, 1])),
		});
	});

	it("has no meaning when either side has no vector", () => {
		const score = scoreDescriptions("Woolies", "Netflix", weights, vectors);
		expect(score).toEqual({ word: 0, meaning: null, merged: 0 });
	});

	it("has no meaning when there are no vectors at all", () => {
		const score = scoreDescriptions("Netflix", "NETFLIX", weights, null);
		expect(score.meaning).toBeNull();
		expect(score.merged).toBe(score.word);
		expect(score.word).toBeCloseTo(1);
	});
});
