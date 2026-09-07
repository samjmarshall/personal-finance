import { describe, expect, it } from "vitest";

import { isPgError } from "./pg-error";

// Stands in for postgres.js's PostgresError — only the SQLSTATE matters here.
function pgError(code: string) {
	return Object.assign(
		new Error("duplicate key value violates unique constraint"),
		{
			code,
		},
	);
}

// Drizzle wraps every driver error in a DrizzleQueryError; the shape that reaches
// a router is this, not the bare PostgresError.
function wrapped(cause: unknown) {
	return Object.assign(new Error("Failed query: update …"), { cause });
}

describe("isPgError", () => {
	it("matches a bare driver error", () => {
		expect(isPgError(pgError("23505"), "23505")).toBe(true);
	});

	it("matches through drizzle's DrizzleQueryError wrapper", () => {
		expect(isPgError(wrapped(pgError("23505")), "23505")).toBe(true);
	});

	it("matches however deeply the driver error is nested", () => {
		expect(isPgError(wrapped(wrapped(pgError("23503"))), "23503")).toBe(true);
	});

	it("rejects a different SQLSTATE, wrapped or not", () => {
		expect(isPgError(pgError("23503"), "23505")).toBe(false);
		expect(isPgError(wrapped(pgError("23503")), "23505")).toBe(false);
	});

	it("rejects an error carrying no SQLSTATE", () => {
		expect(isPgError(new Error("connection lost"), "23505")).toBe(false);
		expect(isPgError(wrapped(new Error("connection lost")), "23505")).toBe(
			false,
		);
	});

	it("rejects non-errors", () => {
		expect(isPgError(null, "23505")).toBe(false);
		expect(isPgError("23505", "23505")).toBe(false);
	});

	it("terminates on a self-referential cause chain", () => {
		const loop: { cause?: unknown } = {};
		loop.cause = loop;
		expect(isPgError(loop, "23505")).toBe(false);
	});
});
