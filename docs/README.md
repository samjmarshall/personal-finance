# Personal Finance

This project is for tracking and managing personal/household finances. Allowing you to see where you are spending, what you have overspent on, identifying where you can save/reduce expenses on the "should haves" and "nice to haves".

Stretch goal for this project:
- Monthly income/expense report generator - Where we overspent or underspent (i.e. saved money) and where we have opportunities for improvement. Also highlighting unplanned expenses that need review, which could simply be spontanious purchases, unexpected transaction fees (FX), possible fraudulent transactions etc..
- Once we have automated transaction sync with invoice/receipt line item analysis and planned / unplanned expense mapping; I would like to build an "Opportunity / Deal finder" engine. A set of solutions that can find/alert on cheaper alternatives to recurring expenses, grocery items in a shopping list like steak on special (e.g. 20-50% discounts at Woolworths) or cheaper alternative at ALDI etc...
- Utilities provider analysis - A solution that can read utilities usage from a CDR recipient for Gas and Electricity (Or I manually upload my Smart Meter usage data and Gas bill usage details) and the solution find current rates from each utilities provider once a month and compares the estimated monthly spend based on current household usage data.
- Home loan analysis - A solution that assess current rates from other lenders once a month and reports load products from lenders that would provide a lower repayment if we refinance our current home loan.

## Environment variables

Validated in `src/env.js`. Pull them locally with `vercel env pull`; set them per-environment in the Vercel project.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | always | Pooled Postgres connection. |
| `DATABASE_URL_UNPOOLED` | optional | Direct connection for drizzle-kit DDL. |
| `BETTER_AUTH_SECRET` | production | Signs session cookies. |
| `KV_REST_API_URL` | production | Upstash Redis REST endpoint. |
| `KV_REST_API_TOKEN` | production | Upstash Redis REST token. |
| `INNGEST_EVENT_KEY` | production | Inngest Cloud key for sending events. |
| `INNGEST_SIGNING_KEY` | production | Inngest Cloud key `serve` uses to verify inbound requests. |
| `BLOB_READ_WRITE_TOKEN` | production | Vercel Blob token; mints client-upload tokens at `/api/receipts/upload` (private store). Injected by the Blob integration in prod. |

`next build` runs with `NODE_ENV=production`, so `make build` and `pnpm run preview` fail locally unless the production-required variables are in `.env`.

### Upstash Redis

Better Auth secondary storage — sessions and verification records dual-write to Redis and Postgres and read Redis-first, with Postgres as the durable copy. Rate-limit counters live here so they are shared across lambdas. See [adr006](adr/adr006-redis-session-cache-with-postgres-durable-copy.md) and [adr007](adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md).

The `KV_` names are fixed by Vercel's Upstash integration. Keys are namespaced `ba:<VERCEL_ENV>:<db-fingerprint>:`, so environments and Neon branches sharing one Upstash database cannot authenticate each other's sessions.

## Async platform (outbox + Inngest)

Side-effecting writes commit their canonical rows and an `outbox` row in one `db.transaction()`, then best-effort `inngest.send`; a cron re-delivers anything the send missed. At-least-once, idempotent on the outbox row `id`. See [adr002](adr/adr002-canonical-postgres-store-transactional-outbox.md); event names live in `src/server/inngest/events.ts` (`EVENT_REGISTRY`).

Inngest reaches the app at `src/app/api/inngest/route.ts` (`/api/inngest`), which serves two scheduled functions:

| Function | Schedule | Purpose |
| --- | --- | --- |
| `outbox-sweep` | `0 * * * *` | Re-deliver unacked rows older than 30s; failures stay unacked for the next run. |
| `outbox-prune` | `0 3 * * *` | Delete rows acked over 7 days ago; never touches unacked or stuck rows. |

Local runs use the Inngest Dev Server (no keys needed). Run `make setup` once — it trusts the Portless CA so the Go Dev Server binary trusts the app's HTTPS cert — then `make start` boots the app plus the Dev Server as sibling Portless processes. The Dev Server syncs the app's `/api/inngest`, lists `outbox-sweep` + `outbox-prune`, and can invoke them from its dashboard at `https://inngest.personal-finance.localhost` (worktree: `https://<branch>.inngest.personal-finance.localhost`).
