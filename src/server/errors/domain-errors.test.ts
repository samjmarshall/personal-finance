import { describe, expect, it } from "vitest";

import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
} from "./domain-errors";

describe.each([
	["NotFoundError", NotFoundError],
	["ConflictError", ConflictError],
	["InvalidInputError", InvalidInputError],
] as const)("%s", (name, DomainError) => {
	it("is an Error carrying the message and its own name", () => {
		const error = new DomainError("gone");
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe("gone");
		expect(error.name).toBe(name);
		expect(error.cause).toBeUndefined();
	});

	it("keeps the cause", () => {
		const cause = new Error("driver");
		expect(new DomainError("gone", { cause }).cause).toBe(cause);
	});
});
