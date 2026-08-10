---
paths:
  - "drizzle/**"
  - "src/server/db/**"
  - "src/server/**/*.schema.ts"
  - "src/server/db/shared.schema.ts"
  - "scripts/seed-dev.ts"
---

# Database Migrations

**Never use `drizzle-kit push`** — it applies schema changes directly without recording them in the migrations table, breaking idempotency.

## Schema layout ([adr005](../../docs/adr/adr005-per-domain-drizzle-schema-files.md))

Tables are authored per-domain in `src/server/<domain>/<domain>.schema.ts`, plus `src/server/db/shared.schema.ts` for domain-less tables (auth). `drizzle-kit` discovers them via the `./src/server/**/*.schema.ts` glob in `drizzle.config.ts`; `src/server/db/index.ts` spread-merges the domain modules into the `db.query.*` schema. New domain-less tables go in the shared bucket — never a stray file. The `*.schema.ts` suffix is reserved for Drizzle table files; Zod schema files use `*-schemas.ts`.

Always use this two-step process:

1. `yarn db:generate` — generate a migration SQL file in `drizzle/`
2. `yarn db:migrate` — apply pending migrations and record them in `__drizzle_migrations`

When schema changes touch tables seeded by `scripts/seed-dev.ts`, update the corresponding fixture in `src/server/db/seed/fixtures/*` in the same PR. The seeder is typesafe — a stale fixture will fail `yarn check` and `yarn build`.

## Data migrations

Data changes coupled to a schema change (back-fill, cutover, seed) belong in a SQL migration alongside it, not in a one-off script someone must remember to run. Generate the file with `yarn db:custom name=<slug>`, write the `INSERT`/`UPDATE`/`DELETE`, then `yarn db:migrate`.

Drizzle migrations are pure SQL — no JS hooks. To trigger an Inngest workflow from one, `INSERT` a row into `outbox` instead of calling `inngest.send` from a script; the `outbox-sweep` cron delivers it at-least-once, idempotent on row id ([adr002](../../docs/adr/adr002-canonical-postgres-store-transactional-outbox.md)). Put rollback notes in a comment at the top of the file.
