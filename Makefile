SHELL := /bin/bash -euo pipefail

.PHONY: install build start check fix audit test test_e2e nvm \
	db_generate db_custom db_migrate db_studio db_check \
	db_branch db_branch_delete db_branch_delete_all db_branch_status clean \
	setup stop

NVMRC_MAJOR := $(shell cut -d. -f1 .nvmrc | sed 's/^v//')
NODE_MAJOR := $(shell node --version | cut -d. -f1 | sed 's/^v//')

# make runs each recipe line in its own shell, so `nvm use` here can't switch the
# node used by dependent targets. This gate can only verify: fail loud on a major
# mismatch and tell the developer to switch.
nvm:
ifneq ($(NVMRC_MAJOR),$(NODE_MAJOR))
	@echo "Error: Node $(NODE_MAJOR) active but .nvmrc wants $(NVMRC_MAJOR). Run: nvm use" >&2
	@exit 1
endif

install: nvm
	pnpm install

build: nvm
	rm -rf .next
	pnpm run build

setup: install
	pnpm exec portless proxy start
	pnpm exec portless trust

start: install
	pnpm run dev

stop:
	pnpm exec portless proxy stop
	pnpm exec portless prune

check: nvm
	pnpm run check
	pnpm run typecheck
	pnpm run db:check

fix: nvm
	pnpm run check:write

# Security audit — gate on real CVEs only, production deps only.
audit: nvm
	pnpm audit --prod --audit-level high

test: nvm
	pnpm run test

# No e2e runner is wired up yet. This exists so .claude/agents/codebase-verification.md
# and /validate don't hard-fail on a missing target. Replace when a runner lands.
test_e2e: nvm
	@echo "skip: no e2e test runner configured"

db_generate: install
	pnpm run db:generate

db_custom: install
	pnpm run db:custom -- --name=$(name)

db_migrate: install
	pnpm run db:migrate

db_studio: install
	pnpm run db:studio

db_check: nvm
	pnpm run db:check

db_branch:
	scripts/neon-branch.sh create

db_branch_delete:
	scripts/neon-branch.sh delete

db_branch_delete_all:
	scripts/neon-branch.sh delete --all

db_branch_status:
	scripts/neon-branch.sh status

clean:
	test ! -d node_modules || pnpm exec portless clean
	rm -rf .next/ next-env.d.ts tsconfig.tsbuildinfo node_modules .playwright-mcp
