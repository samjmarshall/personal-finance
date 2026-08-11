SHELL := /bin/bash -euo pipefail

# `server-only` throws at import unless the `react-server` export condition is set.
# `next build` sets it; `tsx`/`drizzle-kit` don't. See .claude/rules/server-only-boundary.md.
export NODE_OPTIONS=--conditions=react-server

# Exception: under the react-server condition Node resolves `react` to its
# react-server build (no createContext/useLayoutEffect), breaking component
# tests. Test targets must not inherit the condition.
test test_e2e: NODE_OPTIONS=

.PHONY: install build dev check fix audit test test_e2e \
	db_generate db_custom db_migrate db_studio db_check \
	db_branch db_branch_delete db_branch_delete_all db_branch_status clean

install:
	yarn

build:
	rm -rf .next
	yarn run build

dev: install
	yarn run dev

check:
	yarn run check
	yarn run typecheck
	yarn run db:check

fix:
	yarn run check:write

# Security audit — gate on real CVEs only, production deps only.
audit:
	yarn audit --groups dependencies --level high

test:
	yarn run test

# No e2e runner is wired up yet. This exists so .claude/agents/codebase-verification.md
# and /validate don't hard-fail on a missing target. Replace when a runner lands.
test_e2e:
	@echo "skip: no e2e test runner configured"

db_generate: install
	yarn run db:generate

db_custom: install
	yarn run db:custom --name=$(name)

db_migrate: install
	yarn run db:migrate

db_studio: install
	yarn run db:studio

db_check:
	yarn run db:check

db_branch:
	scripts/neon-branch.sh create

db_branch_delete:
	scripts/neon-branch.sh delete

db_branch_delete_all:
	scripts/neon-branch.sh delete --all

db_branch_status:
	scripts/neon-branch.sh status

clean:
	rm -rf .next/ next-env.d.ts tsconfig.tsbuildinfo node_modules
