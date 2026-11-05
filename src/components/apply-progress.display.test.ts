import { describe, expect, it } from "vitest";
import { DuplicateApplyStatus } from "~/lib/constants";
import {
	appliedLabel,
	applyOutcome,
	applyProgressLabel,
	applyStoppedLabel,
} from "./apply-progress.display";

describe("appliedLabel", () => {
	it("counts what was applied", () => {
		expect(appliedLabel({ applied: 1, gone: 0, taken: 0 })).toBe(
			"Applied 1 answer.",
		);
		expect(appliedLabel({ applied: 3, gone: 0, taken: 0 })).toBe(
			"Applied 3 answers.",
		);
	});

	it("says which no longer needed an answer and which still need one", () => {
		expect(appliedLabel({ applied: 2, gone: 1, taken: 2 })).toBe(
			"Applied 2 answers. 1 no longer needed an answer. 2 still need an answer: the bank's row is already in your transactions.",
		);
		expect(appliedLabel({ applied: 0, gone: 2, taken: 1 })).toBe(
			"2 no longer needed an answer. 1 still needs an answer: the bank's row is already in your transactions.",
		);
	});
});

describe("applyProgressLabel", () => {
	it("counts the done ones against the total", () => {
		expect(applyProgressLabel({ total: 200, pending: 80 })).toBe("120 of 200");
		expect(applyProgressLabel({ total: 1200, pending: 1200 })).toBe(
			"0 of 1,200",
		);
	});
});

describe("applyStoppedLabel", () => {
	it("says where it stopped and how many didn't apply", () => {
		expect(applyStoppedLabel({ total: 200, pending: 80 })).toBe(
			"Stopped at 120 of 200. 80 answers didn't apply.",
		);
		expect(applyStoppedLabel({ total: 3, pending: 1 })).toBe(
			"Stopped at 2 of 3. 1 answer didn't apply.",
		);
	});
});

describe("applyOutcome", () => {
	const finished = {
		status: DuplicateApplyStatus.Done,
		active: false,
		pending: 0,
		gone: 0,
		taken: 0,
	};

	it.each([
		["done, all applied", finished, "success"],
		["done, some gone", { ...finished, gone: 1 }, "warning"],
		["done, some taken", { ...finished, taken: 2 }, "warning"],
		[
			"failed",
			{ ...finished, status: DuplicateApplyStatus.Failed, pending: 3 },
			"error",
		],
		// No progress for 15 min: its job is dead, though no one marked it yet.
		[
			"running but stopped",
			{ ...finished, status: DuplicateApplyStatus.Running, pending: 3 },
			"error",
		],
		[
			"failed after its last Answer",
			{ ...finished, status: DuplicateApplyStatus.Failed },
			"success",
		],
		[
			"stopped after its last Answer, some taken",
			{ ...finished, status: DuplicateApplyStatus.Running, taken: 1 },
			"warning",
		],
	] as const)("%s → %s", (_, apply, outcome) => {
		expect(applyOutcome(apply)).toBe(outcome);
	});
});
