import { describe, expect, it } from "vitest";

import { toDateInput } from "~/lib/utils";
import { submittedDate } from "./submitted-date";

// A synced row's date: UTC midnight, not the member's local midnight.
const SAVED = new Date("2026-10-15T00:00:00.000Z");

describe("submittedDate", () => {
	it("sends back the saved instant when the day is untouched", () => {
		expect(submittedDate(toDateInput(SAVED), SAVED)).toBe(SAVED);
	});

	it("sends local midnight of a changed day", () => {
		expect(submittedDate("2026-10-20", SAVED)).toEqual(new Date(2026, 9, 20));
	});

	it("sends local midnight for a new row", () => {
		expect(submittedDate("2026-10-20", undefined)).toEqual(
			new Date(2026, 9, 20),
		);
	});
});
