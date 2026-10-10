---
date: 2026-09-03
status: Done
---
# Inngest Local Dev Server Implementation Plan

## Context
The Inngest outbox rail (serve route + `outbox-sweep`/`outbox-prune` crons) exists, but there is no wired-up way to run the Inngest Dev Server locally — only a stale one-off command in the docs (`docs/README.md:44`). We want `make start` to bring up the app **and** its Dev Server together, so functions sync and can be invoked locally with no keys. The setup must keep **git-worktree parallelism** (two worktrees running at once, each on its own URL), which is the standard local workflow here (`.claude/skills/worktree/SKILL.md`).

## Current State
- `dev` script is a single Portless-wrapped process: `"dev": "portless run next dev --turbo"` (`package.json:16`). `make start` → `yarn run dev` (`Makefile:31-32`); `make setup` runs `portless proxy start` + `portless trust` once (`Makefile:27-29`).
- Portless is a loopback reverse proxy: it binds `:443` and forwards `https://personal-finance.localhost` (branch-prefixed in worktrees) to the child on a **random `127.0.0.1:4000-4999`** port, injecting `PORT`, `PORTLESS_URL`, and `NODE_EXTRA_CA_CERTS` into the child (`node_modules/portless/README.md:35,451-457`). `portless trust` adds its local CA to the **system** trust store (`node_modules/portless/README.md:266-283`).
- `next.config.js:8-11` already trusts `personal-finance.localhost` + `*.personal-finance.localhost`.
- Inngest client is bare: `new Inngest({ id: "personal-finance", eventKey: env.INNGEST_EVENT_KEY })` (`src/server/inngest/client.ts:13-16`) — no `isDev`/`baseUrl`/`serveHost`, so dev-vs-cloud mode is driven entirely by env.
- Serve route: `export const { GET, POST, PUT } = serve({ client: inngest, functions })` (`src/app/api/inngest/route.ts:12`); registers `[sweepWorker, pruneWorker]` (cron-only) from `src/server/outbox/outbox.workers.ts:88-107`.
- `inngest@4.18.1` is a dep (`package.json:41`); the SDK reads `INNGEST_DEV`, `INNGEST_BASE_URL`, `INNGEST_SERVE_ORIGIN` from `process.env` (verified present in `node_modules/inngest`). **No** `inngest-cli`, no `concurrently`, no `docker-compose.yml` today.
- `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` are `requiredInProd`, optional in dev (`src/env.js:45-46`). The Dev Server needs neither.

## Desired End State
`make setup` once, then `make start` runs two Portless processes concurrently:
- App at `https://personal-finance.localhost` (worktree: `https://<branch>.personal-finance.localhost`).
- Inngest Dev Server at `https://inngest.personal-finance.localhost` (worktree: `https://<branch>.inngest.personal-finance.localhost`), which syncs the app's `/api/inngest`, lists `outbox-sweep` + `outbox-prune`, and can invoke them. Both directions run over HTTPS through Portless (both processes trust the Portless CA), so a second worktree runs the same stack with zero port collisions.
- A `docker-compose.yml` scaffold + `make services` targets exist so backing services (redis/postgres/localstack/dynamodb-local) can be added later — Inngest deliberately stays on the host.

## Out of Scope
- Producing/consuming real registry events or worker execution of receipts (stage 5; `src/server/inngest/events.ts:7`).
- Running Inngest itself in Docker (rejected: fixing a Docker container port breaks worktree parallelism — see References, Inngest #1882).
- Any change to prod Inngest config, `src/env.js`, `next.config.js`, the client, or the serve route.

## Approach
Mirror the proven rekurve pattern (`/Users/sam/workspace/rekurve/rekurve/scripts/`): run the Dev Server as a **second Portless-named process** (`inngest.personal-finance`) alongside the app via `concurrently`. Two small shell scripts read the Portless-injected `PORT`/`PORTLESS_URL` and derive each other's hostnames by string-swapping the `inngest.` subdomain, so everything is worktree-safe. Three SDK env vars (set in the app script only, never in `src/env.js`) flip dev mode and force the sync origin back through the Portless HTTPS URL. Docker is used **only** as an optional scaffold for future stateful services, which the app dials out to and never need to call back in.

## Phase 1: Run the Inngest Dev Server as a sibling Portless process

### Changes
- `package.json` — add devDependencies `inngest-cli` (`^1.19.1`; provides the `inngest` binary) and `concurrently`; replace the `dev` script and add two sub-scripts:
  - `"dev": "concurrently -k -n app,inngest -c blue,green \"yarn dev:app\" \"yarn dev:inngest\""`
  - `"dev:app": "portless run --force ./scripts/dev-app.sh"`
  - `"dev:inngest": "portless run --force --name inngest.personal-finance ./scripts/dev-inngest.sh"`
- `scripts/dev-app.sh` — **new**, executable (`chmod +x`, commit the exec bit). Run by `portless run` (which injects `PORT`/`PORTLESS_URL`). Contents:
  - Guard: `: "${PORTLESS_URL:?run via 'portless run'}"`.
  - `export INNGEST_BASE_URL="${PORTLESS_URL/personal-finance.localhost/inngest.personal-finance.localhost}"` — event-send path → the sibling Dev Server's Portless URL (worktree-safe: `<branch>.personal-finance.localhost` → `<branch>.inngest.personal-finance.localhost`).
  - `export INNGEST_DEV=1` — flip SDK to dev mode (accept unsigned sync, skip signature verification). The SDK defaults to **cloud** mode and would reject the sync without this; `INNGEST_BASE_URL` only sets the URL, not the mode.
  - `export INNGEST_SERVE_ORIGIN="$PORTLESS_URL"` — report the public Portless origin at sync time so the Dev Server invokes steps back over `https://…personal-finance.localhost` instead of the internal `http://127.0.0.1:$PORT` Portless forwards to (avoids the "server gave HTTP response to HTTPS client" failure).
  - `exec next dev --turbo`.
- `scripts/dev-inngest.sh` — **new**, executable. Run by `portless run --name inngest.personal-finance`. Contents:
  - Guards: `: "${PORT:?…}"`, `: "${PORTLESS_URL:?…}"`.
  - `NEXT_URL="${PORTLESS_URL/inngest./}"` — strip the `inngest.` subdomain to get the app URL (worktree-safe).
  - `exec inngest dev --port "$PORT" --connect-gateway-port "$((PORT+1))" --connect-gateway-grpc-port "$((PORT+2))" --connect-executor-grpc-port "$((PORT+3))" -u "$NEXT_URL/api/inngest"` — bind the API/UI to the Portless-assigned `$PORT` and derive the connect ports from it so parallel worktrees never collide (their defaults are fixed).
- `docs/README.md:44` — replace the stale `npx … inngest-cli … dev` line with the new workflow: `make setup` once (trusts the Portless CA — required so the Go Dev Server binary trusts the app's HTTPS cert), then `make start` runs the app + Dev Server; dashboard at `https://inngest.personal-finance.localhost`; no keys needed.

### Success
**Automated**
- [x] `make check` passes
- [x] `make test` passes
- [x] `make install` pulls `inngest-cli`; the `inngest` binary resolves (`yarn inngest version` → `1.44.0`). No `.npmrc`/`.yarnrc` fallback needed.
- [x] `make setup` (once) then `make start`: both processes boot; app at `https://personal-finance.localhost`, Dev Server dashboard at `https://inngest.personal-finance.localhost` with **no TLS warnings** and status showing the app synced.
- [x] Dashboard lists `outbox-sweep` and `outbox-prune`.
- [x] End-to-end rail smoke (needs a feature-branch DB, per `.claude/rules/database-migrations.md`): `INSERT` a `pending` outbox row; invoke `outbox-sweep` from the dashboard → the event appears in the stream and the row's `processed_at` is stamped. Invoke `outbox-prune` → a recently-processed row and a stuck (`processed_at is null`) row both survive.
- [x] Worktree parallelism: from a second worktree run `make start` → it comes up at `https://<branch>.personal-finance.localhost` + `https://<branch>.inngest.personal-finance.localhost` with **no port collision** while the first stack is still running.

## Phase 2 (optional): docker-compose scaffold for future backing services

### Changes
- `docker-compose.yml` — **new**. Header comment stating Inngest is intentionally **not** here (it runs via Portless for worktree parallelism; see `scripts/dev-inngest.sh`). A `services:` block with a fully-commented example (redis) showing the pattern, so adding a service is uncommenting a few lines and running `make services`.
- `Makefile` — add `.PHONY` targets `services` (`docker compose up -d`) and `services_down` (`docker compose down`); extend the `.PHONY` list (`Makefile:3-6`).
- `docs/README.md` — short "Local backing services" note: how to add a compose service and that the app reaches it at `localhost:<published-port>` (these services dial-in only; unlike Inngest they never call back into the app, so no Portless bridging is needed).

### Success
**Automated**
- [ ] `make check` passes
- [ ] `docker compose config` validates the file (`make services` is a no-op until a service is uncommented)

**Manual**
- [ ] Uncommenting the example service and running `make services` starts it; `make services_down` stops it. (Confirmatory — no service is required by the app yet.)

## References
- Ticket: none (pre-PMF prototype; no issue tracker).
- Prior plan: `thoughts/plans/2026-09-01-expense-linking-stage-4.md:156` — defined the serve route + workers and the old host-run Dev Server smoke step this workflow supersedes.
- Prior art (rekurve, verbatim pattern this mirrors): `/Users/sam/workspace/rekurve/rekurve/scripts/dev-inngest.sh`, `/Users/sam/workspace/rekurve/rekurve/scripts/dev-rekurve.sh`, `/Users/sam/workspace/rekurve/rekurve/package.json` (dev/`concurrently` scripts), `/Users/sam/workspace/rekurve/rekurve/Makefile`.
- Code: `package.json:16`, `Makefile:27-36`, `next.config.js:8-11`, `src/server/inngest/client.ts:13-16`, `src/app/api/inngest/route.ts:12`, `src/server/outbox/outbox.workers.ts:88-107`, `docs/README.md:33-44`.
- Portless internals: `node_modules/portless/README.md:35,246-262,451-457` (random 4000-4999 child port, loopback-only, injected `PORT`/`PORTLESS_URL`/`NODE_EXTRA_CA_CERTS`); `:266-283` (system-trust CA — why the Go Dev Server binary trusts the app's HTTPS after `portless trust`).
- Why not Docker for Inngest: Inngest issue [#1882](https://github.com/inngest/inngest/issues/1882) (flaky Dockerized sync) + a fixed container port would break worktree parallelism. The host-run + compose-for-data-services split keeps parallelism and still satisfies "add redis/postgres/localstack easily."
