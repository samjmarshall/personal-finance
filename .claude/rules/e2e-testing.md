---
paths:
  - "e2e/**"
  - "playwright.config.ts"
---

# E2E Testing

## Domain tables are unscoped — for now

`transaction`, `expense`, `income` and `expense_category` currently have **no scoping column** —
every signed-in user reads the same rows. Signing in as a fresh user does **not** give a spec a
clean dataset.

This is interim. These tables are slated to gain a `householdId` (a group of users — typically a
couple or family — sharing income and expenses). **When that column lands, revisit this section**:
the correct pattern becomes "each spec seeds its own household and scopes every assertion to it",
and the workarounds below stop being necessary.

Until then:

- **Never assert on totals, counts, or "first row" ordering** over an unfiltered list. Another
  spec's rows are in there. Assert on the specific rows the spec created, located by their own
  unique text.
- **Never assert absence** (`toHaveCount(0)`, empty-state copy) unless the spec filters to a
  token only it could have produced.
- Parallel workers share one dataset. A spec that can't tolerate that must be serialised
  explicitly, not left to chance.

Prefer writing specs whose isolation comes from unique seeded data rather than from a clean table.
Those survive the `householdId` migration unchanged; specs that assume an empty database will not.

## Unique per run

Only three columns are `UNIQUE`: `user.email`, `session.token`, `expense_category.name`.
`expense_category.name` is the one that bites — two specs creating "Groceries" collide and the
second fails on the constraint, not on the behaviour under test. (That constraint is global today;
under `householdId` it should become composite, at which point the collision disappears.)

Generate a per-run suffix (timestamp + random) for every category name and user email. Never
hard-code either.

## Cleanup

Track the ids of rows a spec creates and delete them in `afterAll`. Postgres is strongly
consistent, so read-after-write needs no polling or retry — if a row isn't there, that's a real
failure, not a timing artefact.

Delete by tracked id. Never clean up with a `LIKE` sweep or a broad filter: without user scoping
those match other specs' rows.

## Auth

`emailAndPassword` is enabled with `autoSignIn: true`, so creating a user signs them in — no
separate sign-in call needed when seeding.

Programmatic sign-in (script or API call, not the UI) **must send an `Origin` header** matching a
`trustedOrigins` entry in `src/server/auth/config.ts`. better-auth returns 403 without it.

## Locators

Prefer `getByTestId()`. Before marking e2e work complete, audit every locator you touched: if it
uses `getByRole()`, `getByText()`, `getByLabel()` or a CSS selector, check the component — switch
to the existing `data-testid`, or add one to the source. This is a blocking gate.

## Environment

`src/env.ts` validates at import via `@t3-oss/env-nextjs`. A standalone script that imports
anything reaching `~/env` must either call `dotenv.config()` first or run with
`SKIP_ENV_VALIDATION=1`.

The target database must have migrations applied — see
[database-migrations](./database-migrations.md). Never `drizzle-kit push` to set up a test
database.
