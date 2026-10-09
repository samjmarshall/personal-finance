import { describe, expect, it } from "vitest";

import { assertRow } from "./assert-row";

describe("assertRow", () => {
	it("returns the row", () => {
		const row = { id: 1 };
		expect(assertRow(row, "create thing")).toBe(row);
	});

	it("throws a plain Error (no transport subclass) naming the operation", () => {
		let thrown: unknown;
		try {
			assertRow(undefined, "create thing");
		} catch (error) {
			thrown = error;
		}
		expect(Object.getPrototypeOf(thrown)).toBe(Error.prototype);
		expect((thrown as Error).message).toBe("Failed to create thing.");
	});
});
