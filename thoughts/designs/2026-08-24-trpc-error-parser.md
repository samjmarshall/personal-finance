# tRPC error parser — normalize DB errors into a tagged union

Date: 2026-08-24
Status: Design (validated in brainstorm; ready for `/write-plan`)
Branch context: `expense-linking-stage-1`

## Problem

Routers catch raw driver errors and branch on bare SQLSTATE codes via
`isPgError(error, "23505")`. Two issues:

- **Codes aren't human-readable.** `23505`/`23503` at the call site carry no
  meaning; a reader must look them up.
- **No shared, extensible normalizer.** Each `catch` re-implements shape
  checks. We want one `parseError(error)` returning a consistent, typed object
  the app branches on — starting with Postgres, extensible to Zod/auth/fetch
  later.

Current call sites: `category.ts` (create + update, `23505` → CONFLICT),
`transaction.ts` (create + update, `23503` → CONFLICT).

## Verified facts (drive the design)

- **Driver is postgres.js (`postgres` 3.4.9)**, not node-postgres (`pg`). Its
  `PostgresError` uses snake_case fields: `code`, `constraint_name`,
  `table_name`, `column_name`, `detail`. (`pg` uses `constraint`/`table`/`column`
  — do not read those.)
- **Drizzle 0.45.2 postgres-js path does not wrap errors.** Its `execute()`
  calls `client.unsafe(...)` directly, no try/catch, so a constraint violation
  throws the **raw `PostgresError` with `.code` at the top level**. Today's
  `isPgError` works; the parser reads `.constraint_name` safely.
- **Wrapping is a future risk**, not a current one. `DrizzleQueryError` exists
  (puts the real error on `.cause`) and the neon-http/`db.batch` path wraps. The
  parser does a cheap shallow `.cause` unwrap so it survives that drift.

## Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Architecture | Throw + boundary normalizer; tagged discriminated union; `??` parser chain |
| 2 | Union shape | Family tag + nested label: `{ kind: "pg"; code; constraint; violation }` \| `{ kind: "unknown"; error }` |
| 3 | Label vocabulary | TS string enum `PgViolation`, seeded with 4 class-23 codes; unmapped → `violation: null` (code still set) |
| 4 | Detection | Shallow `.cause` unwrap; detect by SQLSTATE shape `/^[0-9A-Z]{5}$/` |
| 5 | Composition | `??` fallthrough (`parsePg(e) ?? { kind: "unknown", error: e }`) |
| 6 | Transport mapping | Inline at call site (per ADR012); `parseError` normalizes only |
| 7 | File / cleanup | New `parse-error.ts` supersedes `pg-error.ts`; delete `isPgError`; refactor 3 call sites |
| 8 | Tests | Co-located Vitest, duck-typed plain-object fixtures, no DB |

Two fixes folded into the refactor, both from the original sketch:

- **Rename the human label off `cause`** → `violation`. `cause` collides with
  `Error.cause` and `TRPCError.cause` (the *original* error).
- **Re-throw the original `error`, not the parsed object.** `throw e` discards
  the stack; `throw error` preserves it.

## Architecture

Single-purpose lib file `src/server/api/lib/parse-error.ts` holding the union,
the enum, the code map, `parsePg`, and `parseError`.

```ts
export enum PgViolation {
  UniqueViolation = "unique_violation",
  ForeignKeyViolation = "foreign_key_violation",
  NotNullViolation = "not_null_violation",
  CheckViolation = "check_violation",
}

// SQLSTATE class 23 (integrity constraint violation). Seeded with the codes in
// use plus two cheap neighbours; extend when a call site needs another.
const PG_VIOLATION_BY_CODE: Record<string, PgViolation> = {
  "23505": PgViolation.UniqueViolation,
  "23503": PgViolation.ForeignKeyViolation,
  "23502": PgViolation.NotNullViolation,
  "23514": PgViolation.CheckViolation,
};

export type ParsedError =
  | {
      kind: "pg";
      code: string; // raw SQLSTATE, always present
      constraint: string | null; // postgres.js constraint_name
      violation: PgViolation | null; // null when code is unmapped
    }
  | { kind: "unknown"; error: unknown };
```

### Detection + shallow unwrap

```ts
const SQLSTATE = /^[0-9A-Z]{5}$/;

type PgLike = { code: string; constraint_name?: string | null };

function asPgError(value: unknown): PgLike | null {
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && SQLSTATE.test(code)
    ? (value as PgLike)
    : null;
}

// Raw PostgresError today; one .cause hop covers a future wrapping driver.
function findPgError(error: unknown): PgLike | null {
  return (
    asPgError(error) ??
    asPgError((error as { cause?: unknown } | null | undefined)?.cause)
  );
}

function parsePg(error: unknown): ParsedError | null {
  const pg = findPgError(error);
  if (!pg) return null;
  return {
    kind: "pg",
    code: pg.code,
    constraint: pg.constraint_name ?? null,
    violation: PG_VIOLATION_BY_CODE[pg.code] ?? null,
  };
}
```

Detection is SQLSTATE-shape, not `name === "PostgresError"`, so it survives
wrapping; and shape-matched rather than "has a `code`" so Node system errors
(`ENOENT`) don't get mistaken for pg errors.

### Composition (extensibility seam)

```ts
export function parseError(error: unknown): ParsedError {
  return parsePg(error) ?? { kind: "unknown", error };
}
```

Adding a family later is one term and one file:
`parsePg(error) ?? parseZod(error) ?? { kind: "unknown", error }`. Each parser
shares the contract `(e: unknown) => ParsedError | null`. If the list ever grows
large, switching to a registry array is a pure refactor.

## Data flow (call site)

`try → parseError → branch on kind+violation → throw TRPCError inline → else re-throw original`.

```ts
// transaction.ts create/update
} catch (error) {
  const e = parseError(error);
  if (e.kind === "pg" && e.violation === PgViolation.ForeignKeyViolation) {
    throw new TRPCError({
      code: "CONFLICT",
      message: FK_CONFLICT_MESSAGE,
      cause: error,
    });
  }
  throw error;
}
```

```ts
// category.ts create/update
} catch (error) {
  const e = parseError(error);
  if (e.kind === "pg" && e.violation === PgViolation.UniqueViolation) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A category with that name already exists.",
      cause: error,
    });
  }
  throw error;
}
```

The narrowing (`e.kind === "pg"`) is what makes `e.violation`/`e.constraint`
reachable — the type-safety payoff over a flat predicate bag.

## Transport mapping stays inline

`parseError` answers *what failed*; the resolver answers *how to surface it*
(tRPC code + message), inline. Rationale:

- **Messages are contextual** — same `23505` reads differently per call site, so
  a central `toTRPCError(parsed)` could only own the code, never the message.
- **ADR012 forbids a shared map here** — it's part of adr004's deferred 3-tier
  architecture, which "may [not] be introduced inside feature branches."

Revisit only when a guard/message is genuinely duplicated across a router **and**
a worker — which is also ADR012's stated signal to revisit the architecture.

## Testing

Co-located `src/server/api/lib/parse-error.test.ts` (Vitest). `parseError` is
pure and duck-typed on `code`, so fixtures are plain objects — no real
`PostgresError`, no DB.

| Case | Input | Expect |
|---|---|---|
| unique | `{ name:"PostgresError", code:"23505", constraint_name:"x" }` | `kind:"pg"`, `violation:unique_violation`, `constraint:"x"` |
| FK | `{ code:"23503", constraint_name:"y" }` | `violation:foreign_key_violation` |
| not_null / check | `23502` / `23514` | matching labels |
| unmapped pg | `{ code:"40001" }` | `kind:"pg"`, `violation:null`, `code:"40001"` |
| wrapped | `{ cause: { code:"23505" } }` | unwraps → `kind:"pg"` |
| non-pg | `new Error("boom")`, `"str"`, `undefined` | `kind:"unknown"`, `error` preserved |
| false-positive guard | `{ code:"ENOENT" }` | `kind:"unknown"` (not SQLSTATE shape) |

The last two rows are load-bearing — they pin the unwrap and the shape guard,
the two bits most likely to regress. No parser-level DB/integration test; the
existing router tests already cover `23503 → CONFLICT` end-to-end and just
re-point at `parseError`.

## Scope

**In scope:** new `parse-error.ts`; delete `pg-error.ts` + `isPgError`; refactor
`category.ts` (2 sites) and `transaction.ts` (2 sites); the two folded fixes
(label rename, re-throw original); co-located test.

**Out of scope (YAGNI):** central `toTRPCError` map; `neverthrow`/Result; a
parser registry array; `ts-pattern`; extra SQLSTATE codes beyond the 4; a Zod/
auth parser (the seam is designed, not built); any `errorFormatter`/`onError`
changes.

## Open items (non-blocking)

- **Verify the neon-http/`db.batch` outbox path's error shape** when the outbox
  first throws a constraint violation (ADR003). The shallow unwrap covers one
  level; if that path double-wraps or renames fields, extend `findPgError`. Not
  reachable from the current 4 call sites.
- **Extend `PG_VIOLATION_BY_CODE`** when a future call site needs to branch on a
  code beyond the seeded 4.

## Dependencies verdict

No new deps. Skipped: `pg-error-constants`/`postgres-error-codes` (frozen 2022);
`@databases/pg-errors` (targets `pg`'s field names, wrong for postgres.js);
`neverthrow`/`ts-pattern` (ergonomics we don't need for two call sites).
