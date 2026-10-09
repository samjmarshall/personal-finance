import { describe, expect, it } from "vitest";

import { ConflictError } from "./domain-errors";
import { rethrowFkConflict } from "./fk-conflict";

// Production shape: drizzle wraps the postgres.js error in a DrizzleQueryError
// with the driver error on `.cause`.
function pgError(code: string) {
	const driver = Object.assign(new Error("postgres"), { code });
	return Object.assign(new Error("Failed query"), { cause: driver });
}

function thrownBy(error: unknown): unknown {
	try {
		rethrowFkConflict(error, "The selected expense no longer exists.");
	} catch (thrown) {
		return thrown;
	}
}

describe("rethrowFkConflict", () => {
	it("turns a wrapped 23503 into a ConflictError with the message and cause", () => {
		const error = pgError("23503");
		const thrown = thrownBy(error);
		expect(thrown).toBeInstanceOf(ConflictError);
		expect(thrown).toMatchObject({
			message: "The selected expense no longer exists.",
			cause: error,
		});
	});

	it.each([
		["a unique violation", pgError("23505")],
		["a plain Error", new Error("boom")],
	])("rethrows %s as the same reference", (_label, error) => {
		expect(thrownBy(error)).toBe(error);
	});
});
