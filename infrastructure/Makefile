# Included by the root Makefile, so every path here is repo-root relative.
# `env` picks the state file and the Vercel target: `make plan env=production`.
env ?= preview
export TF_VAR_environment = $(env)
TF_CHDIR = -chdir=infrastructure

# deploy.yml passes AWS_ACCOUNT_ID from GitHub vars; locally it is fixed.
ifneq ($(CI),true)
export AWS_ACCOUNT_ID = 139035987018
endif

# Preview state is shared by every branch, so concurrent pushes queue on the
# state lock instead of failing.
TF_LOCK = -lock-timeout=10m

fmt-check:
	terraform $(TF_CHDIR) fmt -check -recursive

fmt:
	terraform $(TF_CHDIR) fmt -recursive

init:
	@echo "terraform env=$(TF_VAR_environment) commit=$(shell git rev-parse --short HEAD)"
	terraform $(TF_CHDIR) init \
		-backend-config=bucket=$(AWS_ACCOUNT_ID)-terraform-state \
		-backend-config=key=personal-finance/$(TF_VAR_environment).tfstate

validate: init
	terraform $(TF_CHDIR) validate

refresh: init validate
	terraform $(TF_CHDIR) refresh $(TF_LOCK)

plan: init validate
	terraform $(TF_CHDIR) plan $(TF_LOCK)

apply: init validate
	terraform $(TF_CHDIR) apply -auto-approve $(TF_LOCK)

# make force-unlock ID=<lock id from the error message>
force-unlock: init
	terraform $(TF_CHDIR) force-unlock -force $(ID)

# Destroying preview removes the shared preview role and env vars, breaking every
# live preview. Use teardown.yml for a single branch (.claude/rules/preview-teardown.md).
destroy: init
ifeq ($(env),production)
	@echo "error: refusing to destroy production" >&2
	@exit 1
endif
	terraform $(TF_CHDIR) destroy -auto-approve $(TF_LOCK)
