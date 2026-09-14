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

// SQLSTATE is exactly five chars from [0-9A-Z]. Shape-only, so a long errno
// (`ENOENT`) is rejected but a 5-char one (`EPIPE`, `EPERM`) still reads as pg —
// harmless: it maps to no PgViolation, and callers only act on a named one.
const SQLSTATE = /^[0-9A-Z]{5}$/;

function asPgError(value: unknown): PgLike | null {
	if (typeof value !== "object" || value === null) return null;
	const { code } = value as { code?: unknown };
	if (typeof code !== "string" || !SQLSTATE.test(code)) return null;
	return value as PgLike;
}

// Drizzle 0.45 wraps the driver error in a DrizzleQueryError and hangs the raw
// postgres.js PostgresError off `.cause` (one level), so the `.cause` hop is the
// load-bearing path, not a fallback — a top-level-only check silently 500'd a
// real 23505 in stage-5. Do not drop it. One hop suffices: drizzle wraps once.
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

// The yes/no guard almost every catch wants: is this a specific named violation?
// Callers that need `code`/`constraint` reach for parseError directly.
export function isPgViolation(error: unknown, violation: PgViolation): boolean {
	const parsed = parseError(error);
	return parsed.kind === "pg" && parsed.violation === violation;
}
