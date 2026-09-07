---
paths:
  - "src/server/**"
  - "src/domain/**"
---

# Server architecture (adr012 / adr005 / adr002)

Feature work ships **plain-router**: tRPC routers with direct `db` calls, no
service / repository / module tiers. [adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md)
describes a 3-tier destination, but [adr012](../../docs/adr/adr012-defer-adr004-plain-routers-for-feature-work.md)
**defers** it — "no service tier, no repository tier, no module ceremony … none
may be introduced inside feature branches." Build in the current style below.

## tRPC routers

- One plain `createTRPCRouter({ … })` per file in `src/server/api/routers/<name>.ts`;
  procedures talk to Drizzle directly via `ctx.db`. No `make*Router({ service })`
  factories, no `*.service.ts` / `*.repository.ts` / `*.module.ts`.
- Compose the pre-built router objects in `src/server/api/root.ts`
  (`balance, cashflow, category, expense, income, setting, transaction`).
- Errors are thrown inline as `TRPCError`. Two shared helpers, not an error tier:
  `isPgError(error, "23505")` (SQLSTATE guard, `src/server/api/lib/pg-error.ts`)
  and `assertRow(row, "op")` (`.returning()` presence, `src/server/api/lib/assert-row.ts`).

## Schema homes (adr005)

Drizzle tables live per-domain in `src/server/<domain>/<domain>.schema.ts` — e.g.
`expenses/expenses.schema.ts`, `expenses/categories.schema.ts`,
`balances/balances.schema.ts`, `auth/auth.schema.ts`. drizzle-kit globs
`src/server/**/*.schema.ts`. Importing a sibling domain's tables for **read**
joins is fine (see `category.ts` joining `expenses`); there is no cross-domain
write ceremony — writes are direct db calls too.

## Domain kernel (`src/domain/`)

Isomorphic-by-need: only what client code shares. Each domain folder holds
`<domain>.dto.ts` (Zod, client + server), `<domain>.interface.ts` (TS types), an
`index.ts` barrel, and occasionally pure compute (`cashflow/cashflow.ts`).

## Writes

Multi-statement writes that must be atomic use the postgres-js interactive
transaction — `await ctx.db.transaction(async (tx) => { … })` (adr002/adr003).
Real examples: `category.ts` `update` (rename + cascade) and `reorder`.

## Outbox + Inngest (adr002)

- `src/server/inngest/events.ts` `EVENT_REGISTRY` is the single event-name +
  payload authority (`EventName`, `EventPayload<K>`, `OutboxEventDescriptor`);
  `buildOutboxEvent(name, payload)` mints a registry-validated descriptor — every
  send goes through it. The client (`client.ts`) is a bare
  `new Inngest({ id, eventKey })`: inngest v4 dropped the typed `schemas` option,
  so safety lives at the mint boundary, not the client type.
- `src/server/outbox/` is the write door. A write-with-side-effects goes through
  `commitWithOutbox` (or `publish` for emit-only): canonical rows + outbox rows
  commit in one `db.transaction()`, then a best-effort post-commit send. The
  `outbox-sweep` cron re-delivers unacked rows as the durable backstop and
  `outbox-prune` drops acked rows past retention (adr002). Never a bare
  `inngest.send` from a handler.

## FROZEN external identifiers

The `EVENT_REGISTRY` keys are Inngest event names — byte-stable wire strings.
`src/server/inngest/registry-golden.test.ts` pins them. Changing one requires
updating the golden test **deliberately** and recording the rename in an ADR
consequence note — never a drive-by.
