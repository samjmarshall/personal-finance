- When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision. Format your response to be easy to understand and read (3rd grader level language). Clear and concise.

---

## Current Project State

**Status**: Pre-PMF Prototype

---

## Build & Test Commands

Prefer Makefile targets with `pnpm` as a fallback — never use `npm`, `npx`, or `yarn` directly:

- `make build` — clean build (`rm -rf .next` + `pnpm run build`)
- `make check` — lint + typecheck + db schema check (`pnpm run check` + `pnpm run typecheck` + `pnpm run db:check`)
- `make fix` - fix lint issues (`pnpm run check:write`)
- `make test` — run Vitest unit tests (`pnpm run test`)
- `make start` — local dev server (`pnpm run dev`)
- `make install` — install dependencies (`pnpm install`)
- `make db_generate` - generate new schema migration files (`pnpm run db:generate`)
- `make db_migrate` - run schema migrations against the db (`pnpm run db:migrate`)

The dev server runs via Vercel Portless - no port.
- Main worktree (no prefix): https://personal-finance.localhost
- Linked worktree on branch "fix-ui": https://fix-ui.personal-finance.localhost

## Database Migrations

Never use `drizzle-kit push`. Always generate and run git tracked migration files with `pnpm run db:generate` and then `pnpm run db:migrate`.

## Local Database

On any branch except `main`, local dev uses a throwaway Neon branch `local/<git-branch>` (made by `scripts/neon-branch.sh` via the `post-checkout` hook). Create, update and delete freely there.

- Check first: `make db_branch_status` must show `*` on `local/<branch>`. On `main`, `.env` points at production, so no writes.
- Vercel Blob is not branched. Rows copied from production share production's files, so deleting a receipt there deletes production's file. Only delete rows you made on the branch.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
