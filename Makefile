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
	yarn

build: nvm
	rm -rf .next
	yarn run build

setup: install
	yarn run portless proxy start
	yarn run portless trust

start: install
	yarn run dev

stop:
	yarn run portless proxy stop
	yarn run portless prune

check: nvm
	yarn run check
	yarn run typecheck
	yarn run db:check

fix: nvm
	yarn run check:write

# Security audit — gate on real CVEs only, production deps only.
audit: nvm
	yarn audit --groups dependencies --level high

test: nvm
	yarn run test

# No e2e runner is wired up yet. This exists so .claude/agents/codebase-verification.md
# and /validate don't hard-fail on a missing target. Replace when a runner lands.
test_e2e: nvm
	@echo "skip: no e2e test runner configured"

db_generate: install
	yarn run db:generate

db_custom: install
	yarn run db:custom --name=$(name)

db_migrate: install
	yarn run db:migrate

db_studio: install
	yarn run db:studio

db_check: nvm
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
	test ! -d node_modules || yarn run portless clean
	rm -rf .next/ next-env.d.ts tsconfig.tsbuildinfo node_modules .playwright-mcp
