/** Payment processors banks put before a merchant, as "PAYPAL *NETFLIX". */
export const PROCESSOR_PREFIXES = [
	"PAYPAL",
	"SQ",
	"SP",
	"ZLR",
	"IZ",
	"LS",
	"DBS",
	"PIN",
	"SMP",
];

/** Country, state and card-suffix words ("Card xx6857, Value date: …") that never name a merchant. */
export const NOISE_WORDS = ["AUS", "AU", "QL", "QLD", "CARD", "VALUE", "DATE"];

/** Titan Text Embeddings V2's default. Every call asks for this size, which Cohere supports from Embed v4 only. */
export const EMBEDDING_DIMENSIONS = 1024;

// Tuned on 576 labelled real pairs (adr029 item 8). An Adopt needs both bars;
// each sits 0.05 above the highest two-purchase pair, or at its floor.
export const ADOPT_WORD_SCORE = 0.55;
export const ADOPT_MEANING_SCORE = 0.7;
/**
 * Merged score at or above this piles a review under "Similar", and lets a held
 * row's copy a day or more off be flagged, not added: raise it and more real
 * copies count twice.
 */
export const SIMILAR_SCORE = 0.59;

export interface WordWeights {
	docs: number;
	/** Distinct cleaned descriptions each word appears in. */
	df: ReadonlyMap<string, number>;
}

export interface DescriptionScore {
	word: number;
	/** Null unless both sides have an embedding. */
	meaning: number | null;
	merged: number;
}

// The `*` is what marks a processor: "SPOTIFY" and "SP CAFE" are merchants.
const PROCESSOR = new RegExp(
	`^\\s*(?:${PROCESSOR_PREFIXES.join("|")})\\s*\\*`,
	"i",
);
const NOISE = new Set(NOISE_WORDS);
// A date goes first: its day and month are under 3 digits, so the code rule would keep them.
const DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
// The bank ends an overseas charge with "FRGN AMT: 20.00  U. S. DOLLAR", which
// sinks a same-purchase pair below the Adopt bars.
const FOREIGN_AMOUNT = /\bFRGN AMT\b.*$/i;

// Card numbers and reference codes (4029357733, P40603); "99 BIKES" keeps its 99.
const isCode = (word: string) => (word.match(/\p{N}/gu)?.length ?? 0) >= 3;

/** Merchant words only, uppercase, each once in first-seen order; "" when all noise. */
export function cleanDescription(text: string): string {
	const words = text
		.replace(PROCESSOR, "")
		.replace(FOREIGN_AMOUNT, "")
		.replace(DATE, "")
		.toUpperCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word && !NOISE.has(word) && !isCode(word));

	return [...new Set(words)].join(" ");
}

/** Takes raw descriptions; each distinct cleaned one counts once, so a weekly merchant stays rare. */
export function wordWeights(corpus: Iterable<string>): WordWeights {
	const docs = new Set<string>();

	for (const text of corpus) {
		const cleaned = cleanDescription(text);

		if (cleaned) docs.add(cleaned);
	}

	const df = new Map<string, number>();

	for (const doc of docs) {
		for (const word of doc.split(" ")) {
			df.set(word, (df.get(word) ?? 0) + 1);
		}
	}

	return { docs: docs.size, df };
}

const idf = (word: string, { docs, df }: WordWeights) =>
	Math.log((1 + docs) / (1 + (df.get(word) ?? 0))) + 1;

const wordsOf = (cleaned: string) =>
	new Set(cleaned.split(" ").filter(Boolean));

/** IDF-weighted cosine of two cleaned descriptions, in [0, 1]; 0 when either is empty. */
export function wordScore(a: string, b: string, weights: WordWeights): number {
	const wordsA = wordsOf(a);
	const wordsB = wordsOf(b);
	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (const word of wordsA) {
		const w = idf(word, weights) ** 2;
		normA += w;

		if (wordsB.has(word)) dot += w;
	}

	for (const word of wordsB) {
		normB += idf(word, weights) ** 2;
	}

	if (dot === 0) return 0;

	return Math.min(1, dot / Math.sqrt(normA * normB));
}

/** Cosine of two embeddings, clamped to [0, 1]. Not `ai`'s cosineSimilarity: this ships to the client. */
export function meaningScore(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	a.forEach((x, i) => {
		const y = b[i] ?? 0;
		dot += x * y;
		normA += x ** 2;
		normB += y ** 2;
	});

	if (dot <= 0) return 0;

	return Math.min(1, dot / Math.sqrt(normA * normB));
}

/** Equal-weight mean; the word score alone when meaning is unavailable. */
export function mergedScore(word: number, meaning: number | null): number {
	return meaning === null ? word : (word + meaning) / 2;
}

/** `vectors` is keyed by cleaned text; null meaning when null or either side is missing. */
export function scoreDescriptions(
	bank: string,
	mine: string,
	weights: WordWeights,
	vectors: ReadonlyMap<string, number[]> | null,
): DescriptionScore {
	const a = cleanDescription(bank);
	const b = cleanDescription(mine);
	const word = wordScore(a, b, weights);
	const vectorA = vectors?.get(a);
	const vectorB = vectors?.get(b);
	const meaning = vectorA && vectorB ? meaningScore(vectorA, vectorB) : null;

	return { word, meaning, merged: mergedScore(word, meaning) };
}
