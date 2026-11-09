# Architecture docs and diagrams

Date: 2026-11-05
Status: Design (validated in brainstorm; ready for `/write-tickets` or `/write-plan`)
Governed by: adr004 (3-tier), adr022 (cross-domain through the owning service), adr002 (outbox)
Precedent: `src/server/architecture.test.ts` (import scan), `src/server/inngest/registry-golden.test.ts` (golden pin)

## Problem

The repo has no single map of the system. Knowledge sits in prose and in 17 scattered Mermaid
diagrams (7 flowchart, 6 sequence, 2 state, 2 ER) inside ADRs and feature docs.

- No view shows the domain ideas and how they link. `CONTEXT.md` Relationships holds about 25
  links, in prose only.
- No view shows the system parts: which domain uses which, which external system each one
  calls, which events trigger which Inngest functions.
- No diagram shows the data model. 19 tables across 11 `*.schema.ts` files.
- Only 1 of 5 status lifecycles is drawn.
- Hand-drawn diagrams drift from the code, and nothing catches it.

**Goal:** a text-first map that the owner and Claude both read to get oriented fast (primary),
and that helps when designing new work (bonus). It offers click-through from feature down to
tables, and CI catches drift.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | Readers: the owner + Claude, for orientation; design use is a bonus. | A public showcase site as the primary goal. |
| 2 | Two separate maps: a **concept map** (domain ideas) and a **software map** (system parts). | One mixed "ontology" diagram. C4 for domain concepts (C4 models software, not ideas). |
| 3 | **LikeC4** for the software map, features and pipeline overviews; **Mermaid** for the concept map, data model, lifecycles and detail flows. | Mermaid only (no real click-through). D2 only (hand-drawn, no model, drifts). Structurizr (mid-shakeup). EventCatalog, IcePanel, Ilograph (event-centric or paid SaaS). |
| 4 | Software map is mixed: top level and pipelines **by hand**; domains, links and events **generated** from code. | All by hand (silent drift). All generated (code can't say why). |
| 5 | Everything lives in `docs/architecture/`; generators in `scripts/diagrams/`. | `.c4` files next to code in `src/server/<domain>/`. |
| 6 | Pipelines split by zoom: LikeC4 step views for the cross-domain overview; Mermaid in feature docs and ADRs for detail. Never the same flow twice at the same zoom. | All pipelines in LikeC4 (weaker on branches and loops). All in Mermaid (no click-through). |
| 7 | Concept map is a hand-drawn Mermaid `classDiagram` in its own file, with a term check against `CONTEXT.md`. | Embedding it in `CONTEXT.md` (token cost for every agent). Generating it from prose. `erDiagram` (looks like tables). |
| 8 | ER pages come from our own script using Drizzle's `getTableConfig()`. | `drizzle-docs-generator` (small third-party, not split by domain). Liam ERD (experimental Drizzle support). |
| 9 | Lifecycles: one `lifecycles.md`, one state diagram per `*Status` enum, with an enum check. | Lifecycles inside feature docs (4 of 5 have none). Skip. |
| 10 | Product layer: one LikeC4 **feature map** (actor → feature → domains). | `usecase-beta` per feature doc (needs Mermaid 12+, GitHub version unknown; tiny diagrams). `requirementDiagram` (SysML fields, poor fit). |
| 11 | View locally via Portless **and** host on GitHub Pages. | Local only. A committed single-file HTML (noisy diffs). |
| 12 | `likec4` installs from its own `docs/architecture/package.json`. | A root devDependency (every CI job pulls it). `pnpm dlx` pinned in the Makefile. |
| 13 | Drift checks for generated files, terms and enums are Vitest golden tests in `make test`; LikeC4 validation and Pages deploy run in a new `architecture.yml`. | Everything in `architecture.yml`. No gate. |
| 14 | Drop D2 from the ADR skill; ADR option diagrams use Mermaid. | Build the never-built D2 pipeline (3 tools, `make diagrams` name clash). LikeC4 for ADR options (rejected options pollute the real model). |
| 15 | Claude gets LikeC4's `likec4-dsl` skill and an AGENTS.md note, with no MCP server for now. | LikeC4 MCP server (the model is small enough to read). |
| 16 | Software map depth: context → containers → server domains. | UI pages from `src/app`. A deployment/infra view (`docs/infrastructure.md` covers it). |

## The map

Each layer answers one question.

| Layer | Question | Tool | Made by | File |
|---|---|---|---|---|
| Feature map | What can people do? | LikeC4 | hand | `model/features.c4` |
| Concept map | What ideas exist, and how do they link? | Mermaid `classDiagram` | hand + term check | `concept-map.md` |
| Software map | What parts exist, and who talks to whom? | LikeC4 | hand (top) + generated | `model/context.c4`, `model/*.generated.c4` |
| Pipelines (overview) | What happens, in what order, across domains? | LikeC4 step views | hand | `model/pipelines.c4` |
| Pipelines (detail) | How does one feature work inside? | Mermaid sequence/flowchart | hand | feature docs, ADRs (unchanged) |
| Data model | What tables and columns? | Mermaid `erDiagram` | generated | `data-model/<domain>.md` |
| Lifecycles | What states can X be in? | Mermaid `stateDiagram-v2` | hand + enum check | `lifecycles.md` |

Decision logic (pairing scores, auto-filing rules) stays as flowcharts in adr029 and adr031.

**Click path** in the LikeC4 viewer: feature → its pipeline view → the domains it touches →
that domain's ER page (link out).

**Entry point:** `docs/architecture/README.md`.

**Rules:**

- The concept map shows ideas; the ER pages show tables. The two diagram shapes differ on
  purpose.
- Never draw the same flow twice at the same zoom.
- Never hand-edit a generated file. Each one carries a header saying so.

## Files and commands

```
docs/architecture/
  README.md                  hub; LikeC4 views as Mermaid between <!-- generated:views --> markers
  package.json, pnpm-lock.yaml   likec4 only
  likec4.config.json
  model/
    spec.c4                  element kinds: actor, external, container, domain, feature, event, function
    context.c4               hand: Member, email sender, scheduler, external systems, containers
    features.c4              hand: feature map
    pipelines.c4             hand: step views
    views.c4                 hand: view list and drill-down
    domains.generated.c4     generated
    events.generated.c4      generated
  concept-map.md             hand
  lifecycles.md              hand
  data-model/README.md       generated overview
  data-model/<domain>.md     generated, 1 per domain
scripts/diagrams/
  domains.ts, events.ts, er.ts   pure: source in, text out
  externals.ts               hand config: code module → external system
  *.test.ts                  golden tests (toMatchFileSnapshot) + unit tests
  splice-views.ts            writes the Mermaid exports into the hub README
```

Generators run **inside Vitest**. Schema files import through `~/` paths, which plain `node`
can't resolve; Vitest already resolves them. `toMatchFileSnapshot()` compares in `make test`
and rewrites with `-u`. The Vitest `unit` project include widens to `scripts/**/*.test.ts`.

| Command | Does |
|---|---|
| `make diagrams` | `vitest run -u scripts/diagrams` → install `docs/architecture` deps if missing → `likec4 gen mermaid` → `splice-views.ts` |
| `make architecture` | `portless run --name architecture.personal-finance likec4 start` → `https://architecture.personal-finance.localhost` (worktree: `https://<branch>.architecture.personal-finance.localhost`) |
| `make test` | now also fails on stale generated files, missing terms and missing enum values |

Hosted at `https://samjmarshall.github.io/personal-finance/` (the repo is public), built with
`likec4 build --base /personal-finance/`.

## Generators

### `domains.ts` → `domains.generated.c4`

- A **domain** is a `src/server/<x>/` folder holding a `*.service.ts` or `*.schema.ts`. Tags
  show its entry points: `#trpc`, `#inngest`, `#http` (from which controller files exist).
- **Links** come from two sources:
  1. Imports inside a domain folder of `~/server/<y>` or `~/domain/<y>`.
  2. Wiring in the composition roots (`src/server/api/services.ts`,
     `src/server/inngest/functions.ts`), read with the TypeScript compiler API:
     `new XService({ dep: … })` means X uses whatever `dep` comes from. This catches injected
     dependencies an import scan misses. For example, `functions.ts` hands Bedrock to the
     receipts and transactions services.
- **`externals.ts`** maps code to outside systems: `aws/bedrock` → Bedrock, `blob-store` →
  Vercel Blob, `cdr.redbark` → RedBark, `email.mailbox` → Resend.
- **Plumbing** folders (`api`, `db`, `errors`, `observability`, `inngest`) are skipped so the
  map shows meaning, not wiring.
- Each domain links to `../data-model/<domain>.md`.

The two import regexes and the resolver mirror `architecture.test.ts`. Decide at plan time
whether to share them through a small module or duplicate about 15 lines.

### `events.ts` → `events.generated.c4`

- Events are the `EVENT_REGISTRY` keys (`src/server/inngest/events.ts`).
- An event's **emitter** is the domain whose code calls `buildOutboxEvent("<event>")`
  (today: the receipts, cdr and transactions repositories).
- **Functions** are the `createFunction({ id, triggers })` calls in `*.inngest.controller.ts`,
  with cron or event triggers and `onFailure` handlers.
- Arrows: domain → event → function, and cron → function.

### `er.ts` → `data-model/*.md`

- Loads every `src/server/*/*.schema.ts` with `import.meta.glob`, detects tables with
  `is(value, PgTable)`, and reads each with `getTableConfig()`.
- One page per domain: columns, types, PK/FK/UK and nullable. A table owned by another domain
  shows as a stub that links to its page.
- Enum values appear under the diagram. Status enums link to `lifecycles.md`.
- The FK sets each link end: a nullable FK gives "zero or one", a unique FK gives "one to one".
- The overview page shows table names and links only.

## Hand-written parts

- **`context.c4`:** Member, email sender, daily scheduler. External systems: RedBark, Bedrock,
  Resend, Vercel Blob, Neon, Upstash, Inngest Cloud, PostHog. Containers: Next.js app (UI +
  tRPC + API routes), Inngest functions, Postgres, Redis, Blob store.
- **`features.c4`:** about 14 features from today's pages and routes. Sign in, cashflow
  dashboard, expenses (incl. one-time budgets), categories & groups, unplanned spend, income,
  transactions & filing (rules, suggestions), daily bank sync, history import, duplicate
  review & apply, receipt upload, receipt email intake, allowed senders, settings. Each has
  actor → feature → domains, plus a `link` to its feature doc when one exists.
- **`pipelines.c4`:** five step views. Daily bank sync, history import, duplicate apply,
  receipt intake (upload + email), outbox delivery. Steps reference **generated** elements, so
  a rename in code fails `likec4 validate` and hand-written views can't drift silently.
- **`views.c4`:** the view list and drill-down: context → containers → domains, and
  feature → pipeline.
- **`concept-map.md`:** Mermaid `classDiagram` in three parts: records & filing, bank import &
  duplicates, receipts. Derived ideas (Unplanned, Planned, Consumed, Remaining) carry
  `<<derived>>`.
- **`lifecycles.md`:** one `stateDiagram-v2` per status enum: `receiptStatus`,
  `cdrConnectionStatus`, `cdrImportStatus`, `possibleDuplicateStatus`,
  `duplicateApplyStatus`. The cdr import diagram moves here from
  `docs/feature/history-import.md`, which then links to it.
- **Hub `README.md`:** how to read the map, the Mermaid exports (context, containers, domains,
  feature map), links to every page, and the hosted viewer link.

## Checks and errors

### In `make test` (no LikeC4 needed)

| Test | Fails when | Message |
|---|---|---|
| domains / events / ER golden | a generated file differs from the code | "run `make diagrams`" |
| term check | a bold term in `CONTEXT.md` Relationships has no class in `concept-map.md` | lists the missing terms |
| enum check | a `*Status` enum, or one of its values, is missing from `lifecycles.md` | lists the missing enums and values |

Vitest never writes snapshots in CI, so a stale file always fails.

### Generators fail loudly instead of guessing

- A domain imports a folder that is not a domain, not plumbing and not in `externals.ts`:
  "classify `src/server/<x>`".
- A function triggers on an event missing from `EVENT_REGISTRY`: error.
- A registry event with no emitter or no function gets an `#orphan` tag rather than an error,
  so it shows on the map without blocking mid-feature work.
- Composition roots: only `*Service` and `*Repository` classes are tracked.

### `.github/workflows/architecture.yml`

Runs on push when `docs/architecture/**`, `scripts/diagrams/**`, `src/server/**` or
`CONTEXT.md` change. Follow `.claude/rules/github-actions.md`.

- **check:** root install + `docs/architecture` install → `make diagrams` →
  `git diff --exit-code` (catches stale hub exports) → `likec4 validate` →
  `likec4 format --check`.
- **deploy** (`main` only, needs check): `likec4 build --base /personal-finance/` →
  `actions/upload-pages-artifact` → `actions/deploy-pages`.
- One-time manual step: set the repo's Pages source to "GitHub Actions".
- Separate from `deploy.yml`, so a broken diagram never blocks an app release.

Out of scope for now: syntax linting for hand-written Mermaid. GitHub's preview shows errors;
a parser-only checker (e.g. check-mmdjs-action) can come later.

## Agent wiring

- Vendor LikeC4's `likec4-dsl` skill (MIT) into `.claude/skills/`, keeping its licence note.
  Refresh it whenever `likec4` is bumped.
- Add a short **AGENTS.md** "Architecture docs" section covering the hub path, which files are
  hand-written vs generated, running `make diagrams` after schema, event, domain or wiring
  changes, and `make architecture` to view.
- **`/domain-model`:** a Relationships change updates `concept-map.md`; a status enum change
  updates `lifecycles.md`.
- **`/document-feature`:** adds the feature to `features.c4` with a link, and links to
  `lifecycles.md` and the pipeline view instead of redrawing them. Its own detail Mermaid
  diagrams stay. Drop the stale `adr001-imessage…` reference while there.
- **`ADR-FORMAT.md` + ADR templates:** drop D2. Option diagrams use Mermaid; link LikeC4 views
  for the current state.
- **`docs/README.md`:** link to the hub.

## Testing

- **Unit:** generator logic as pure functions over small fixtures (fake file maps, a tiny
  Drizzle table). Covers nullable and unique FKs, cross-domain stubs, an unclassified folder,
  an orphan event, cron vs event triggers, and an injected dependency in a composition root.
- **Golden:** each generator over the real code, pinned with `toMatchFileSnapshot()`.
- **Checks:** term and enum checks, each with a failing fixture to prove they catch drift.
- **CI:** `likec4 validate` and `format --check` in `architecture.yml`.

## Rollout

0. **Spike.** Does `likec4 gen mermaid` output render well on GitHub? Test in a draft PR, and
   check GitHub's Mermaid version with an `info` block. Does Pages work with the base path?
   **Fallback:** the hub embeds `likec4 export png` images.
1. **ER generator + data-model pages.** Independent of LikeC4; useful even if LikeC4 is dropped.
2. **LikeC4 skeleton:** package, `spec`/`context`/`views`, `make architecture`,
   `architecture.yml`, hub.
3. **Domains + events generators**, `externals.ts`.
4. **Features + pipelines.**
5. **Concept map + term check.**
6. **Lifecycles + enum check**; move the history-import state diagram.
7. **Agent wiring.**

**Way back to Mermaid only:** export every view with `likec4 gen mermaid` into the Markdown
pages, then delete `model/`, `docs/architecture/package.json` and `architecture.yml`.

## Open questions

- Which Mermaid version does GitHub render today? It decides whether `usecase-beta` (12.0+)
  is ever usable there. The spike answers it.
- Do `likec4 gen mermaid` exports read well on GitHub, or do they need the PNG fallback?
- Does `likec4 validate` exit non-zero on layout drift alone, or only on syntax errors?
- Share the import-scan helper with `architecture.test.ts`, or duplicate it?

## ADR Candidates

Run `/domain-model thoughts/designs/2026-11-05-architecture-docs-and-diagrams.md` to capture these as Proposed ADRs.

- **Architecture docs: LikeC4 model + Mermaid, partly generated from code and drift-gated in
  `make test`.** It passes gates 2 and 3. A schema or event change now fails `make test` until
  `make diagrams` runs, which surprises without context, and five tools were weighed. Gate 1
  (hard to reverse) is borderline, because the Mermaid exit path is cheap. Record it with the
  simple template if you want the "why does my test fail after a schema change" answer on
  file.
