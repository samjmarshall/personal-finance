import { describe, expect, it } from "vitest";

import { PgViolation, parseError } from "./parse-error";

// Stands in for postgres.js's PostgresError — only the SQLSTATE and constraint
// name are read. postgres.js throws this shape with `.code` at the top level.
function pgError(code: string, constraint_name?: string) {
	return Object.assign(new Error("postgres"), { code, constraint_name });
}

describe("parseError", () => {
	it("parses a unique violation into a named PgViolation", () => {
		expect(parseError(pgError("23505", "x"))).toEqual({
			kind: "pg",
			code: "23505",
			constraint: "x",
			violation: PgViolation.UniqueViolation,
		});
	});

	it("maps each seeded SQLSTATE to its violation", () => {
		expect(parseError(pgError("23503", "y"))).toEqual({
			kind: "pg",
			code: "23503",
			constraint: "y",
			violation: PgViolation.ForeignKeyViolation,
		});
		expect(parseError(pgError("23502"))).toEqual({
			kind: "pg",
			code: "23502",
			constraint: null,
			violation: PgViolation.NotNullViolation,
		});
		expect(parseError(pgError("23514"))).toEqual({
			kind: "pg",
			code: "23514",
			constraint: null,
			violation: PgViolation.CheckViolation,
		});
	});

	it("keeps kind:pg but leaves violation/constraint null for an unmapped code", () => {
		expect(parseError(pgError("40001"))).toEqual({
			kind: "pg",
			code: "40001",
			constraint: null,
			violation: null,
		});
	});

	it("unwraps one .cause hop to find the driver error", () => {
		const wrapped = Object.assign(new Error("Failed query"), {
			cause: pgError("23505", "x"),
		});
		expect(parseError(wrapped)).toEqual({
			kind: "pg",
			code: "23505",
			constraint: "x",
			violation: PgViolation.UniqueViolation,
		});
	});

	it("returns kind:unknown with the value preserved for non-pg input", () => {
		const err = new Error("boom");
		expect(parseError(err)).toEqual({ kind: "unknown", error: err });
		expect(parseError("str")).toEqual({ kind: "unknown", error: "str" });
		expect(parseError(undefined)).toEqual({
			kind: "unknown",
			error: undefined,
		});
	});

	it("does not read a Node error code (ENOENT) as a driver error", () => {
		expect(parseError(pgError("ENOENT"))).toEqual({
			kind: "unknown",
			error: expect.any(Error),
		});
	});
});
