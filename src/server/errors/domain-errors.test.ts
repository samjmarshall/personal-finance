import { describe, expect, it } from "vitest";

import {
	ConflictError,
	DomainError,
	InvalidInputError,
	NotFoundError,
	UnauthorizedError,
} from "./domain-errors";

describe.each([
	["NotFoundError", NotFoundError, "not_found"],
	["ConflictError", ConflictError, "conflict"],
	["InvalidInputError", InvalidInputError, "invalid_input"],
	["UnauthorizedError", UnauthorizedError, "unauthorized"],
] as const)("%s", (name, ErrorClass, kind) => {
	it("is a DomainError carrying the message, its own name and its kind", () => {
		const error = new ErrorClass("gone");
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(DomainError);
		expect(error.message).toBe("gone");
		expect(error.name).toBe(name);
		expect(error.kind).toBe(kind);
		expect(error.cause).toBeUndefined();
	});

	it("keeps the cause", () => {
		const cause = new Error("driver");
		expect(new ErrorClass("gone", { cause }).cause).toBe(cause);
	});
});
