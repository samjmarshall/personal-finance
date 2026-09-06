import { describe, expect, it } from "vitest";

import { CommitmentKind, toCommitmentKind } from "./constants";

describe("toCommitmentKind", () => {
	it("maps the managed vocab through unchanged", () => {
		expect(toCommitmentKind("recurring")).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind("one-time")).toBe(CommitmentKind.OneTime);
	});

	it("coerces an out-of-vocab value to Recurring", () => {
		expect(toCommitmentKind("weekly")).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind(null)).toBe(CommitmentKind.Recurring);
		expect(toCommitmentKind(undefined)).toBe(CommitmentKind.Recurring);
	});
});
