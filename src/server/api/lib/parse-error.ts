// A driver error normalized into a tagged union the routers narrow on, so a
// `catch` branches on a named violation instead of a bare SQLSTATE string.

// PostgreSQL SQLSTATE classes we act on today. Values are the codes' canonical
// names; extend by seeding PG_VIOLATION_BY_CODE, not by reading raw codes.
export enum PgViolation {
	UniqueViolation = "unique_violation",
	ForeignKeyViolation = "foreign_key_violation",
	NotNullViolation = "not_null_violation",
	CheckViolation = "check_violation",
}

const PG_VIOLATION_BY_CODE: Record<string, PgViolation> = {
	"23505": PgViolation.UniqueViolation,
	"23503": PgViolation.ForeignKeyViolation,
	"23502": PgViolation.NotNullViolation,
	"23514": PgViolation.CheckViolation,
};

export type ParsedError =
	| {
			kind: "pg";
			code: string;
			constraint: string | null;
			violation: PgViolation | null;
	  }
	| { kind: "unknown"; error: unknown };

// A postgres.js PostgresError as we read it: a SQLSTATE `code` and an optional
// snake_case `constraint_name`.
type PgLike = { code: string; constraint_name?: unknown };

// SQLSTATE is exactly five chars from [0-9A-Z]; the length gate is what keeps a
// Node `ENOENT` from reading as a driver error.
const SQLSTATE = /^[0-9A-Z]{5}$/;

function asPgError(value: unknown): PgLike | null {
	if (typeof value !== "object" || value === null) return null;
	const { code } = value as { code?: unknown };
	if (typeof code !== "string" || !SQLSTATE.test(code)) return null;
	return value as PgLike;
}

// One `.cause` hop is enough today: postgres.js throws the raw PostgresError with
// a top-level `.code` on every live path (ADR003 — db.batch swap deferred).
function findPgError(error: unknown): PgLike | null {
	return asPgError(error) ?? asPgError((error as { cause?: unknown })?.cause);
}

function parsePg(error: unknown): ParsedError | null {
	const pg = findPgError(error);
	if (!pg) return null;
	return {
		kind: "pg",
		code: pg.code,
		constraint:
			typeof pg.constraint_name === "string" ? pg.constraint_name : null,
		violation: PG_VIOLATION_BY_CODE[pg.code] ?? null,
	};
}

// The `??` seam is where a future Zod/auth parser slots in.
export function parseError(error: unknown): ParsedError {
	return parsePg(error) ?? { kind: "unknown", error };
}
