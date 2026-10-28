import { describe, expect, it } from "vitest";
import { importChunks, importEarliestDay } from "./import-chunks";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayAfter = (day: string) =>
	new Date(Date.parse(day) + DAY_MS).toISOString().slice(0, 10);

describe("importChunks", () => {
	it("gives one chunk for one day", () => {
		expect(importChunks("2026-03-01", "2026-03-01")).toEqual([
			{ from: "2026-03-01", to: "2026-03-01" },
		]);
	});

	it("fits exactly 90 days in one chunk", () => {
		expect(importChunks("2026-01-01", "2026-03-31")).toEqual([
			{ from: "2026-01-01", to: "2026-03-31" },
		]);
	});

	it("splits 91 days into two", () => {
		expect(importChunks("2026-01-01", "2026-04-01")).toEqual([
			{ from: "2026-01-01", to: "2026-03-31" },
			{ from: "2026-04-01", to: "2026-04-01" },
		]);
	});

	it("covers 7 years with no gap or overlap, ending on to", () => {
		const chunks = importChunks("2019-10-28", "2026-10-28");

		expect(chunks[0]?.from).toBe("2019-10-28");
		expect(chunks.at(-1)?.to).toBe("2026-10-28");
		for (const [i, chunk] of chunks.entries()) {
			expect(chunk.from <= chunk.to).toBe(true);
			const next = chunks[i + 1];
			if (next) expect(next.from).toBe(dayAfter(chunk.to));
		}
		expect(chunks).toHaveLength(29);
	});
});

describe("importEarliestDay", () => {
	it("is the same day seven years back", () => {
		expect(importEarliestDay("2026-10-28")).toBe("2019-10-28");
	});
});
