import { describe, expect, it } from "vitest";

import {
	ConflictError,
	InvalidInputError,
	NotFoundError,
	UnauthorizedError,
} from "./domain-errors";
import { httpStatusFor } from "./http-status";

describe("httpStatusFor", () => {
	it.each([
		["NotFoundError", new NotFoundError("gone"), 404],
		["ConflictError", new ConflictError("taken"), 409],
		["InvalidInputError", new InvalidInputError("bad"), 400],
		["UnauthorizedError", new UnauthorizedError("who"), 401],
	] as const)("maps a %s to %i", (_name, error, status) => {
		expect(httpStatusFor(error)).toBe(status);
	});

	it("gives undefined for a plain Error", () => {
		expect(httpStatusFor(new Error("boom"))).toBeUndefined();
	});

	it("gives undefined for a thrown non-Error", () => {
		expect(httpStatusFor("boom")).toBeUndefined();
		expect(httpStatusFor(undefined)).toBeUndefined();
	});
});
