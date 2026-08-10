---
paths:
  - "src/server/**"
  - "src/domain/**"
---

# Server architecture (adr004 / adr005 / adr002)

Domain-oriented 3-tier under `src/server/<domain>/`, with an isomorphic kernel at `src/domain/`. Decision record: [adr004](../../docs/adr/adr004-domain-oriented-3-tier-server-architecture.md); schema homes: [adr005](../../docs/adr/adr005-per-domain-drizzle-schema-files.md); outbox posture: [adr002](../../docs/adr/adr002-canonical-postgres-store-transactional-outbox.md).

## Tier map — dotted suffixes

Files declare their tier in their name, with two sanctioned exceptions: entry adapters named for their protocol surface (e.g. `hubspot.webhook.ts`), and module-private composition internals with plain names (e.g. hubspot's `contacts.ts` / `emails.ts` / `client.ts`), which are never imported outside their module:

| Suffix | Tier | Notes |
|---|---|---|
| `<domain>.router.ts` | tRPC adapter | `make*Router({ service })` factory; wired in `src/server/api/root.ts`, never in the module |
| `<domain>.worker.ts` (or `<verb>-<noun>.worker.ts`) | Inngest adapter | exports factories only: `makeRun*(deps)` pure core + `make*Worker(deps)` `createFunction` wrapper |
| `<domain>.workers.ts` | workers composition root | builds the Inngest adapters ONCE at module scope; served by the functions registry (`src/server/inngest/functions.ts`) |
| `<domain>.service.ts` | service | `make*Service(deps)`; throws domain errors, never transport errors |
| `<domain>.repository.ts` | repository | `make*Repository({ db, commitWithOutbox })`; never exported from the module |
| `<domain>.module.ts` | composition root | the only place real deps are wired (import-time singletons) |
| `<domain>.schema.ts` | Drizzle tables | per-domain schema home (adr005) |
| `<domain>.decide.ts` | pure decision core | write-heavy flows only (see below) |
| `<domain>.channels.ts` | realtime channel adapter | e.g. `leads.channels.ts` (Inngest Realtime publish) |
| `<domain>.errors.ts` | domain errors | mapped to tRPC in `src/server/api/trpc-error-map.ts` |
| `<domain>-schemas.ts` | Zod schemas | dash, not dot — Zod validation schemas, distinct from the Drizzle `.schema.ts` |

## Module surface

`<domain>.module.ts` exports `{ service }` (plus `channels` where the domain has a realtime surface — see `leads.module.ts`). **Not** `{ router, workers, service }`: entry-point adapters are wired by their host registries so service-only consumers never load the adapter graphs —

- tRPC routers → `src/server/api/root.ts` (`makeLeadsRouter({ service: leadsModule.service })`), keeping webhook/worker consumers off the trpc/auth graph.
- Inngest workers → `<domain>.workers.ts` → the functions registry `src/server/inngest/functions.ts`, keeping route handlers off the inngest client graph.

**The repository is never exported.** Cross-domain consumption is service-port-to-service-port, wired module→module (e.g. `hubspotModule` consumes `leadsModule.service.stampHubspotContactId`). The module dep graph stays acyclic; where a cycle threatens, the flow is event-mediated (hubspot↔messaging engagement events).

## Write path

`commit(writes[], outboxEvents)` — plural — is a domain repository's **only write door**: a discriminated-union write descriptor list plus typed outbox event descriptors, executed as one `db.batch` via `makeCommitWithOutbox` (`src/server/outbox/commit.ts`). The outbox rides the signature (adr002/adr003). Emit-only surfaces with no canonical rows use the outbox `publish` (`src/server/outbox/index.ts`) — never a bare `inngest.send` from a handler (adr002).

`decide()` is **earned on write-heavy flows only** — today: lead capture/update (`leads.decide.ts`), message approve/editAndApprove (`messaging.decide.ts`). Pure: input + current state + injected ctx/now → write descriptors + outbox event descriptors; the service does load → guard → decide → commit. CRUD-thin flows stay imperative service→repository calls that still terminate in `commit`. Do not add `decide()` ceremony elsewhere; do not inline write logic back into services.

## Reads and cross-domain access

- **Read-model-join rule:** importing a sibling domain's `*.schema.ts` tables for READ joins is allowed (dashboard-shaped queries). Cross-domain **writes** go through service ports only.
- Domain reads pass through all three tiers even as one-line pass-throughs — the designated home for future role-scoping; don't "optimize them away".

## Errors and events

- Services throw domain errors (`<domain>.errors.ts`); the shared `toTRPCError` map (`src/server/api/trpc-error-map.ts`) owns the tRPC representation. Codes/messages there are byte-stable.
- `src/server/inngest/events.ts` (`EVENT_REGISTRY`) is the single naming + payload authority: `EventName`, `EventPayload<K>`, `OutboxEventDescriptor`, and the correlated `SendEvent` port for direct-send worker deps. Consumers pin wire strings module-privately with `as const satisfies Record<string, EventName>` — no shared name-map barrels.

## Collapse rule

- **Worker-only domains** (`nurture/`): no module file composing an empty `{service}` — the `<domain>.workers.ts` root is the domain's public artifact.
- **Outbox** (`outbox/`) is write-path infrastructure, not a plain worker-only domain: alongside its `outbox.workers.ts` composition root it exports the write-door helpers every domain consumes — `publish` (`src/server/outbox/index.ts`) and `makeCommitWithOutbox` (`src/server/outbox/commit.ts`) — per the write path above.
- **Adapter modules** (`ms-graph/`, `twilio/`, `ai/`): typed client surfaces injected into owning domains; no router/service/repository ceremony (ai keeps a thin `ai.module.ts` + rate-limited router for its draft endpoint).
- **Stub domains** (`lots/`): router + schema only until real behavior lands (`lots.getAll` returns `[]`).

## FROZEN external identifiers

Inngest function ids (`lead-hubspot-sync`, `nurture-plan-runner`, `outbox-sweep`, `outbox-prune`, `dispatch-*`, `reconcile-missed-engagement`), `step.run` / `waitForEvent` step ids, and event names (the `EVENT_REGISTRY` keys) are byte-stable external identifiers — Inngest memoisation/replay keys and wire strings. Tripwires pin them: `src/server/inngest/__tests__/registry-golden.test.ts` (functions + events) and `src/server/api/__tests__/router-paths-golden.test.ts` (tRPC paths). Changing one requires updating the golden test **deliberately** and recording the rename in an ADR consequence note — never as a drive-by.

## Isomorphic kernel (`src/domain/`)

Isomorphic-by-need, not a purity museum: only what client code genuinely shares lives there (scoring, messaging correlation, client-imported Zod schemas). Purity alone does not buy a kernel seat — `decide()` fns are server-side (`server-only`-marked). See `.claude/rules/server-only-boundary.md` for the boundary mechanism.
