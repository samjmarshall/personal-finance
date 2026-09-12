# tRPC Error Parser — normalize DB errors into a tagged union — Implementation Plan

## Context
Plain tRPC routers catch raw driver errors and branch on bare SQLSTATE strings via
`isPgError(error, "23505")` — the codes carry no meaning at the call site and every
`catch` re-implements the shape check. This plan replaces `isPgError` with one shared,
typed `parseError(error)` that returns a discriminated union the routers narrow on
(`kind: "pg"` with a named `PgViolation`), extensible to Zod/auth families later. It
executes the validated design at `thoughts/designs/2026-08-24-trpc-error-parser.md`,
reconciled to the current code (see Current State).

## Current State
- Helper `isPgError(error, code)` walks the `.cause` chain up to depth 10 —
  `src/server/api/lib/pg-error.ts:12`; tested in `src/server/api/lib/pg-error.test.ts`.
- Driver is **postgres.js** (`postgres` 3.4.9) on Neon's pooled endpoint via
  `db.transaction()`; the neon-http/`db.batch` swap is **deferred** (ADR003), so every
  live path throws the **raw `PostgresError` with `.code` at top level** and snake_case
  fields (`constraint_name`). A shallow one-hop `.cause` unwrap covers all current paths.
- Four routers import `isPgError` (design named only the first two — the last two landed
  after 2026-08-24):
  - `src/server/api/routers/category.ts:11,62,111` — 2 inline sites, `23505` → unique →
    CONFLICT "A category with that name already exists." (no `cause` set today).
  - `src/server/api/routers/transaction.ts:32,48` — local helper
    `rethrowFkConflict(error, msg)` (`23503` → FK → CONFLICT), called by `create:201`,
    `update:221`, `linkExpense:272`.
  - `src/server/api/routers/receipts.ts:31,51,287` — its own `rethrowFkConflict` helper
    (`23503`) plus `confirmMatch` inline `23505` → CONFLICT "That transaction already
    has a receipt."
  - `src/server/api/routers/allowed-sender.ts:11,49` — `add` inline `23505` → CONFLICT
    "That address is already on the allowlist."
- `src/server/api/routers/receipts.match.test.ts:25` has a stale comment naming
  `isPgError`; it does not import it (defines its own `pgError` fixture).
- Vitest collects `src/**/*.test.ts` (`vitest.config.ts`); tests are colocated.

## Desired End State
- `src/server/api/lib/parse-error.ts` exports `PgViolation`, `ParsedError`, and
  `parseError(error): ParsedError`. `parseError` is pure, duck-typed on `code`, and
  detects pg errors by SQLSTATE **shape** (`/^[0-9A-Z]{5}$/`) with one `.cause` hop.
- `pg-error.ts` and `pg-error.test.ts` are deleted; no source imports `isPgError`.
- All four routers branch on `parseError(...).kind === "pg"` + a named `PgViolation`,
  re-throw the **original** `error` on the pass-through path, and set `cause: error` on
  the `TRPCError` they raise. Member-facing messages are byte-for-byte unchanged.
- `parse-error.test.ts` pins the union, the label map, the shallow unwrap, and the
  false-positive guard. Existing router tests pass unchanged (they cover
  `23505`/`23503` → CONFLICT end-to-end and just re-point at `parseError`).

## Out of Scope (YAGNI, per design)
Central `toTRPCError` map; `neverthrow`/Result; a parser registry array; `ts-pattern`;
SQLSTATE codes beyond the seeded 4; a Zod/auth parser (the `??` seam is designed, not
built); any `errorFormatter`/`onError` change; migrating any router toward adr004 3-tier.

## Approach
Ship in two build-safe phases. Phase 1 adds `parse-error.ts` via the TDD vertical-slice
loop while `pg-error.ts` still exists — nothing breaks. Phase 2 migrates all four
routers, deletes `pg-error.ts`/`pg-error.test.ts`, and fixes the stale comment in one
atomic change so no dangling import survives. Keep each router's existing structure:
re-point the local `rethrowFkConflict` helpers instead of inlining them (a local
per-file helper is not the shared central map the design rules out), and fold in the
design's two corrections — human label named `violation` (not `cause`) and re-throw the
original `error` (not the parsed object).

## Phase 1: `parse-error.ts` + colocated test (TDD)

### Changes
- `src/server/api/lib/parse-error.ts` — new. Holds:
  - `enum PgViolation { UniqueViolation="unique_violation", ForeignKeyViolation=
    "foreign_key_violation", NotNullViolation="not_null_violation", CheckViolation=
    "check_violation" }`.
  - `const PG_VIOLATION_BY_CODE: Record<string, PgViolation>` seeded `23505/23503/
    23502/23514`.
  - `type ParsedError = { kind:"pg"; code:string; constraint:string|null;
    violation:PgViolation|null } | { kind:"unknown"; error:unknown }`.
  - `asPgError(value)` → `PgLike | null` (SQLSTATE-shape guard on `.code`);
    `findPgError(error)` = `asPgError(error) ?? asPgError(error?.cause)` (one hop);
    `parsePg(error)` → `ParsedError | null`; `parseError(error)` =
    `parsePg(error) ?? { kind:"unknown", error }`.
- `src/server/api/lib/parse-error.test.ts` — new. Plain-object fixtures, no DB. Drive
  impl one slice at a time, each test forcing the next bit of code:
  1. unique happy path `{ name:"PostgresError", code:"23505", constraint_name:"x" }` →
     `{ kind:"pg", violation:UniqueViolation, code:"23505", constraint:"x" }` (forces the
     union + `parsePg` + `parseError` + first map entry).
  2. FK `{ code:"23503", constraint_name:"y" }` → `ForeignKeyViolation`; not_null
     `23502`; check `23514` (forces remaining map entries).
  3. unmapped pg `{ code:"40001" }` → `{ kind:"pg", violation:null, code:"40001",
     constraint:null }` (forces `?? null` on both fields).
  4. wrapped `{ cause: { code:"23505" } }` → `kind:"pg"` (forces the `.cause` hop).
  5. non-pg `new Error("boom")`, `"str"`, `undefined` → `{ kind:"unknown", error }` with
     `error` preserved (forces the unknown branch).
  6. false-positive guard `{ code:"ENOENT" }` → `kind:"unknown"` (forces the SQLSTATE
     regex — 6 chars fails the length gate; a Node `ENOENT` must not read as pg).

### Success
- [x] `make check` passes
- [x] `make test` passes (new `parse-error.test.ts` green)
- [x] `parseError` returns `kind:"pg"` for a bare `{code:"23505"}` and for
      `{cause:{code:"23505"}}`, and `kind:"unknown"` for `{code:"ENOENT"}`
- [x] `pg-error.ts` still present and untouched (nothing imports the new file yet)

## Phase 2: migrate the four routers, delete `pg-error.*`

### Changes
- `src/server/api/routers/category.ts` — replace `import { isPgError }` with
  `import { parseError, PgViolation }`. At `:62` and `:111` swap
  `if (isPgError(error, "23505"))` for
  `const e = parseError(error); if (e.kind === "pg" && e.violation ===
  PgViolation.UniqueViolation)`; add `cause: error` to the `TRPCError`; keep the trailing
  `throw error`. Message unchanged.
- `src/server/api/routers/transaction.ts` — swap the import; re-point the local
  `rethrowFkConflict` (`:47`) internals to
  `const e = parseError(error); if (e.kind === "pg" && e.violation ===
  PgViolation.ForeignKeyViolation) throw new TRPCError({ code:"CONFLICT", message,
  cause: error }); throw error;`. The three call sites (`create/update/linkExpense`) are
  unchanged. Messages unchanged.
- `src/server/api/routers/receipts.ts` — swap the import; re-point its
  `rethrowFkConflict` (`:51`) the same way; at `confirmMatch` (`:287`) swap the inline
  `23505` guard for the `PgViolation.UniqueViolation` narrowing + `cause: error`.
  Messages unchanged.
- `src/server/api/routers/allowed-sender.ts` — swap the import; at `add` (`:49`) swap the
  inline `23505` guard for the `PgViolation.UniqueViolation` narrowing + `cause: error`.
  Message unchanged.
- `src/server/api/routers/receipts.match.test.ts:25` — update the stale comment to name
  `parseError` (cosmetic; no behavior change).
- Delete `src/server/api/lib/pg-error.ts` and `src/server/api/lib/pg-error.test.ts`.

### Success
- [x] `make check` passes (no remaining `isPgError` import; `grep -rn isPgError src/`
      returns nothing)
- [x] `make test` passes — existing `transaction`, `category`, `receipts`,
      `allowed-sender`, and `receipts.match` router tests green unchanged
- [x] Unique-violation sites still surface CONFLICT with their exact prior messages;
      FK-violation sites still surface CONFLICT; any non-constraint error re-throws the
      original (stack preserved)
- [x] `pg-error.ts` / `pg-error.test.ts` no longer exist

## Validation (whole branch)
- Run `/validate` → `/code-review` over the branch before opening the PR (standing step,
  not a per-phase item).

## Notes / decisions folded in
- **Design citations reconciled:** ADR012 (design's "keep it inline" basis) was
  superseded 2026-09-09 and archived; the same outcome now rests on ADR004's strangler
  rule — these routers are not yet migrated, so transport mapping stays inline and
  `parse-error.ts` is a plain shared lib (alongside `assert-row.ts`), not a tier. The
  design's neon-http/`db.batch` open item is moot: ADR003 deferred that swap.
- **Behavior narrowing (intentional):** the shallow one-hop unwrap replaces `isPgError`'s
  depth-10 chain walk. Safe today — postgres.js throws the raw `PostgresError` with a
  top-level `.code`; the `.cause` hop is future-proofing. The deleted deep-nesting /
  self-referential-loop tests are not reproduced by design.

## References
- Design doc: `thoughts/designs/2026-08-24-trpc-error-parser.md` (locked decisions 1–8;
  union shape, `??` composition, test table)
- ADRs: `docs/adr/adr003-neon-http-db-batch-for-atomic-outbox-writes.md` (Accepted —
  postgres-js retained, db.batch deferred; drives the shallow-unwrap safety argument);
  `docs/adr/adr004-domain-oriented-3-tier-server-architecture.md` (Accepted — strangler
  rule: no 3-tier refactor inside a feature diff); `docs/adr/archived/adr012-defer-adr004
  -plain-routers-for-feature-work.md` (superseded 2026-09-09 — the design's stale cite)
- Server-architecture rule: `.claude/rules/server-architecture.md` (plain-router section;
  `isPgError`/`assertRow` shared helpers)
- Replaces: `src/server/api/lib/pg-error.ts:12`, `src/server/api/lib/pg-error.test.ts`
- Call sites: `category.ts:62,111`; `transaction.ts:47`; `receipts.ts:51,287`;
  `allowed-sender.ts:49`; stale comment `receipts.match.test.ts:25`
