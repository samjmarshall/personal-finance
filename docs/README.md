# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)
- [Better Auth](https://better-auth.com)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## Environment variables

Validated in `src/env.js`. Pull them locally with `vercel env pull`; set them per-environment in the Vercel project.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | always | Pooled Postgres connection. |
| `DATABASE_URL_UNPOOLED` | optional | Direct connection for drizzle-kit DDL. |
| `BETTER_AUTH_SECRET` | production | Signs session cookies. |
| `KV_REST_API_URL` | production | Upstash Redis REST endpoint. |
| `KV_REST_API_TOKEN` | production | Upstash Redis REST token. |

`next build` runs with `NODE_ENV=production`, so `make build` and `yarn preview` fail locally unless the production-required variables are in `.env`.

### Upstash Redis

Better Auth secondary storage — sessions and verification records dual-write to Redis and Postgres and read Redis-first, with Postgres as the durable copy. Rate-limit counters live here so they are shared across lambdas. See [adr006](adr/adr006-redis-session-cache-with-postgres-durable-copy.md) and [adr007](adr/adr007-asymmetric-failure-posture-in-the-redis-adapter.md).

The `KV_` names are fixed by Vercel's Upstash integration. Keys are namespaced `ba:<VERCEL_ENV>:<db-fingerprint>:`, so environments and Neon branches sharing one Upstash database cannot authenticate each other's sessions.

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel).
