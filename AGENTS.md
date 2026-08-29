- When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision. Format your response to be easy to understand and read (3rd grader level language). Clear and concise.

---

## Current Project State

**Status**: Pre-PMF Prototype

---

## Build & Test Commands

***Prerequisite:*** Run `nvm use` - Configure the correct version of Node.js for the project, specified in `.nvmrc`.

Prefer Makefile targets with `yarn` as a fallback — never use `npm` or `npx` directly:

- `make build` — clean build (`rm -rf .next` + `yarn build`)
- `make check` — lint + typecheck + db schema check (`yarn run check` + `yarn run typecheck` + `yarn run db:check`)
- `make fix` - fix lint issues (`yarn run check:write`)
- `make test` — run Vitest unit tests (`yarn test`)
- `make start` — local dev server (`yarn run dev`)
- `make install` — install dependencies (`yarn`)
- `make db_generate` - generate new schema migration files (`yarn db:generate`)
- `make db_migrate` - run schema migrations against the db (`yarn db:migrate`)

The dev server runs via Vercel Portless - no port.
- Main worktree (no prefix): https://personal-finance.localhost
- Linked worktree on branch "fix-ui": https://fix-ui.personal-finance.localhost

## Database Migrations

Never use `drizzle-kit push`. Always generate and run git tracked migration files with `yarn db:generate` and then `yarn db:migrate`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
