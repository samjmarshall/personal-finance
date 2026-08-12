---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-08-10'
# prettier-ignore
---

# Co-locate Drizzle table definitions per-domain with a shared bucket and a merge barrel

## Context and Problem Statement

[adr004](adr004-domain-oriented-3-tier-server-architecture.md) organises `src/server/` as vertical domain modules. The Drizzle schema is the one thing that decision leaves centrally grouped: `src/server/db/schema.ts` is a single 159-line file holding every table in the system — `post`, `expense`, `income`, `transaction`, the four better-auth tables (`user`, `session`, `account`, `verification`), and their `relations()` declarations. [adr002](adr002-canonical-postgres-store-transactional-outbox.md) adds an `outbox` table that needs a home.

Two things make the move cheap. Cross-file foreign keys already resolve through lazy thunks — `posts.createdById` uses `.references(() => user.id)` — which is the technically risky half of any schema split, and it is already proven here. And there is no migration history to protect: there is no `drizzle/` directory at all.

## Decision Drivers

- **Verticality consistency with adr004.** A central schema folder is the last standing exception to "opening a domain folder shows everything about that domain."
- **Migration-tooling integrity.** Whatever the layout, `drizzle-kit generate` must discover every table, and the project must end up with a real `drizzle/` history and a populated `__drizzle_migrations` — the layout is an authoring concern, not a database concern.
- **FK and import safety across files.** Already proven by the existing lazy thunks; the move must keep the schema-level import graph one-directional.
- **Glob hygiene.** A `*.schema.ts` glob must never sweep a Zod file into drizzle-kit.
- **Auth tables are domain-less.** better-auth owns `user` / `session` / `account` / `verification`; they belong to no domain and must stay exactly the set better-auth expects.

## Considered Options

1. One `*.schema.ts` per domain, co-located in the domain module, plus an auth-only shared bucket, a drizzle-kit glob and a spread-merge barrel
2. Status quo — keep the single central `src/server/db/schema.ts`
3. A central `src/server/db/schema/` folder with one file per entity and a barrel

## Decision Outcome

Chosen option: "1. One `*.schema.ts` per domain, co-located in the domain module, plus an auth-only shared bucket, a drizzle-kit glob and a spread-merge barrel", because the lazy-thunk FKs and the absent migration history make co-location a cheap move rather than a risky split, and it removes the last central exception to adr004's one-folder-per-domain rule.

Layout:

```text
src/server/
├── transactions/
│   └── transactions.schema.ts   # transaction table + its indexes
├── expenses/
│   └── expenses.schema.ts       # expense table
├── income/
│   └── income.schema.ts         # income table
├── outbox/
│   └── outbox.schema.ts         # outbox table + partial unprocessed index
└── db/
    ├── table.ts                 # shared table factory (not swept by the glob)
    ├── shared.schema.ts         # better-auth: user, session, account, verification
    └── index.ts                 # spread-merge barrel -> drizzle(sql, { schema })
```

Specifics that bind:

- **`drizzle.config.ts` discovers tables by glob**, `./src/server/**/*.schema.ts`, replacing the single-file path.
- **`*.schema.ts` is reserved for Drizzle tables.** Zod validation schemas use `*-schemas.ts` — dash, not dot — so the glob cannot sweep them. This is the same distinction adr004 draws in its tier map, and it is load-bearing here rather than cosmetic.
- **`src/server/db/shared.schema.ts` is the auth-only bucket.** Per-domain plus one honest shared bucket, not 100% per-domain. New domain-less tables go here rather than into a stray new file.
- **The `outbox` table lands module-vertical** at `src/server/outbox/outbox.schema.ts`, not in the shared bucket. It has a module (`src/server/outbox/`, which also owns `commit.ts` and the sweep worker); it is infrastructure with a home, not a homeless table.
- **`src/server/db/index.ts` spread-merges** the domain schema modules into one object passed to `drizzle(sql, { schema })`, so `db.query.*` continues to see every table.
- **The `pgTableCreator` prefix is retired.** Tables are declared with plain `pgTable`, and `tablesFilter` is removed from `drizzle.config.ts`. The prefix exists in the T3 scaffold so several projects can share one database; adr003 gives this project its own Neon database, and the better-auth tables already bypass the prefix entirely — so it buys nothing and currently breaks table discovery. Retiring it is what makes `tablesFilter` unnecessary rather than merely corrected. `src/server/db/table.ts` remains as the shared home for any future table-declaration helper.
- **The `post` table is deleted, not moved** — dead T3 scaffold, per adr004.

No architecture diagram for this ADR: the decision is a file-layout delta with no runtime topology, and the tree above is the whole picture. Forcing a diagram onto it would be theatre.

### Implementation status

Implemented 2026-08-10. The glob and the spread-merge barrel were wired first, as required: **ordering matters** — the glob and the barrel must be wired *before* the first per-domain schema file moves and before the first migration is generated, or `drizzle-kit` will generate a migration that drops every table it can no longer see.

Baseline is `drizzle/0000_small_joseph.sql` — seven tables, no prefix, no `post` — applied to a dropped-and-recreated database and recorded as the single row in `drizzle.__drizzle_migrations`.

Three notes for anyone reading this later:

- The Context above says "there is no `drizzle/` directory at all". True when this was written; a `drizzle/` had since been generated but was never committed or applied, so the decision was unaffected. It was discarded and regenerated.
- `src/server/db/table.ts` was **not** created. With the prefix retired it would hold nothing; deferred until there is a helper to put in it.
- The drop uncovered a `pg-drizzle_category` table (5 rows) present in neither the schema nor any migration — orphaned by an earlier push. Nothing read it: expense categories are hardcoded in `src/lib/constants.ts`. Dropped, so `public` now holds exactly the seven tables in the baseline.

### Positive Consequences

- **Opening a domain folder shows its tables.** `transactions/` holds its schema beside its repository, service and workers.
- **Table discovery starts working.** Removing the prefix and the filter fixes the mismatch that currently leaves every table unmanaged by drizzle-kit.
- **The project gains a real migration history.** The baseline migration is the first entry in `drizzle/` and `__drizzle_migrations`, which is what makes the two-step `generate` → `migrate` workflow in `.claude/rules/database-migrations.md` true instead of aspirational — and what makes the `db:push` block a constraint rather than a dead end.
- **The outbox table sits with the code that writes it**, so adr002's machinery is one folder.
- **Adding a domain adds one file**, discovered automatically by the glob with no barrel edit at the drizzle-kit layer.

### Negative Consequences

- **The glob is a footgun with a sharp edge.** A Zod file accidentally named `*.schema.ts` gets swept into drizzle-kit and can generate a nonsense migration. The `*-schemas.ts` convention is the only thing preventing it, and nothing enforces it automatically.
- **Wiring order is load-bearing and unguarded.** Moving a schema file before the glob lands generates a destructive migration. This is a one-time hazard with no tooling behind it.
- **Table definitions are no longer readable in one place.** Answering "what tables exist?" becomes a glob instead of opening one file. Accepted, because `db.query.*` autocomplete and the barrel still present the merged set.
- **The shared bucket is a judgement call that will be tested.** "Domain-less" is clear for better-auth today; the first table that is arguably shared between `transactions` and `expenses` will need a ruling.

## Pros and Cons of the Options

### 1. Per-domain `*.schema.ts` + auth-only shared bucket + glob + barrel

| Pros                                                                        | Cons                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Consistent with adr004 — no central exception left                          | "What tables exist?" needs a glob, not one file                         |
| Tables sit beside the repository that writes them                           | The `*.schema.ts` glob can sweep a misnamed Zod file                    |
| Adding a domain adds one auto-discovered file                               | Wiring order is load-bearing and unguarded                              |
| Lazy-thunk FKs already prove cross-file references work here                | The shared bucket's boundary is a judgement call                        |

### 2. Status quo — single central `src/server/db/schema.ts`

- Good, because every table is visible in one 159-line file, which at this size is genuinely easy to read.
- Good, because it is zero work and carries no wiring-order hazard.
- Bad, because it is the last violation of adr004's one-folder-per-domain rule, and the file grows monotonically as domains and the outbox arrive.
- Bad, because it leaves the `tablesFilter` / prefix mismatch unaddressed — that bug has to be fixed regardless, and this option provides no occasion to fix it.

### 3. Central `db/schema/` folder, one file per entity, plus a barrel

- Good, because it splits the file without touching the domain modules, and is the smallest step from the status quo.
- Bad, because it buys the cost of a split without the payoff: tables still live away from the code that writes them, so a domain change still spans two distant folders.
- Bad, because it is a strictly intermediate stop. Having decided adr004, this option means doing the same migration twice.

## Links

- Refines: [adr004](adr004-domain-oriented-3-tier-server-architecture.md) — the schema-location sub-decision within that architecture
- Table home for: [adr002](adr002-canonical-postgres-store-transactional-outbox.md) — the `outbox` table lands at `src/server/outbox/outbox.schema.ts`
- Operational statement: `.claude/rules/database-migrations.md` — the two-step generate/migrate workflow and the `drizzle-kit push` ban this layout finally makes workable
