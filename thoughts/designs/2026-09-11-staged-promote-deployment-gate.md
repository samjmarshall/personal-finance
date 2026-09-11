---
date: 2026-09-11
topic: Staged production deploys with a promote gate (deployment lifecycle leaves Terraform)
status: Draft design — ready for /write-plan or /write-tickets
amends: adr013 (update in place after implementation, via /domain-model; no new ADR)
---

# Staged production deploys with a promote gate

## Problem

The `DB Migration` Vercel Deployment Check gated production promotion and kept
getting stuck "pending". Root cause, confirmed from the provider source
(`vercel/vercel` v5.15.1, `client/deployment.go`):

- `vercel_deployment` Create polls `for !IsComplete()` where
  `IsComplete() = AliasAssigned && AliasError == nil`. It waits on the alias
  being **assigned**, not on `readyState == READY`, for every target, with **no
  timeout and no poll deadline**.
- With auto-aliasing on and the `DB Migration` check holding the production
  alias, the provider polls until the `deploy.yml` job hits its 25-minute cap and
  is cancelled.
- Re-runs created multiple production deployments on the same commit SHA, all
  writing the one `DB Migration` commit-status context. That is Vercel's
  documented collision/race, which made the check flap and never settle.

Two consequences fixed the direction of the design:

1. Terraform **cannot** create a staged (un-promoted) production deployment. Turn
   auto-assign off and the alias never comes, so Create would poll forever. There
   is also no promote resource in the provider, and `vercel_alias` is a plain
   domain upsert that bypasses Vercel's `Current`/instant-rollback tracking.
2. A real pre-promote gate therefore requires the deployment to leave Terraform.

## Decision

Terraform owns **infrastructure only**. GitHub Actions `deploy.yml` owns the
**deployment lifecycle**: build, migrate, gate, promote.

- Both environments create their Vercel deployment with the Vercel CLI, not
  Terraform.
- Production uses stage then gate then promote. Preview just deploys and
  migrates.
- The `DB Migration` Deployment Check, the Repository Dispatch integration, and
  `post-deploy.yml` are all removed. No `repository_dispatch`, no commit-status
  race, no alias-wait deadlock.
- No automated rollback for now. Drizzle runs all pending migrations in one
  transaction, so a failed migrate leaves the DB unchanged and fails the job
  before promote. That is the accepted safety net.

## Flow (deploy.yml, every push)

1. **terraform apply** — infra only (project, prod domain, IAM role, 3 Bedrock
   env vars, protection-bypass secret). Fast now: no deployment resource, so no
   alias wait.
2. **vercel deploy** — preview: plain. production: `--prod --skip-domain`. Both
   stamp `--meta githubCommitRef=<branch>` (and `githubCommitSha`). Capture the
   deployment URL from stdout. This deploy is what makes the Neon-Vercel
   integration provision the DB branch, so it must come before migrate.
3. **Resolve Neon branch** — production: the primary branch. preview:
   `preview/<git ref>`. Poll the Neon branches API until it exists, then resolve
   the unpooled connection string via the `./.github/actions/neon-db-url`
   composite action.
4. **make db_migrate** — unpooled (DDL not through PgBouncer). One transaction:
   any failure rolls the whole set back and fails the job, so no promote.
5. **Gate (production only)** — curl `/api/health` on the staged deployment URL
   with the `x-vercel-protection-bypass` header, assert HTTP 200. Failure stops
   the job; the previous production deployment stays `Current`.
6. **Promote (production only)** — `vercel promote <url> --yes`. Marks the
   deployment `Current` and preserves instant-rollback.

The GitHub environment URL is now set from the CLI stdout, not a Terraform
output.

## Terraform changes (infrastructure/)

- Remove `vercel_deployment.this` and `terraform_data.deploy_sha` (both prod and
  preview).
- Set `vercel_project.auto_assign_custom_domains = false` so production builds
  stage instead of auto-aliasing.
- Add `vercel_project_protection_bypass` (32-char, sensitive) and a matching
  sensitive output the workflow reads with `terraform output -raw`.
- `outputs.app_url`: production stays the static custom domain
  (`https://finance.sammarshall.co`). Drop the preview branch of the expression;
  the preview URL comes from the CLI now.
- `data.vercel_project` in the preview state still supplies the project id and
  env-var targets.

## The gate (minimal seam)

- New route `src/app/api/health/route.ts`. `GET` returns HTTP 200 with a shallow
  `select 1` readiness check, so it catches a broken DB connection or bad env,
  not just liveness. Plain `Request`/`Response`, no auth on the route itself.
- The staged deployment URL is behind Vercel Authentication (SSO,
  `all_except_custom_domains`), so the check sends the bypass header. The secret
  is Terraform-managed (see above), passed to the curl step.
- Later, Playwright e2e drops into the same gate step. The seam is the point; the
  first check is deliberately tiny.

## Migrations discipline

Migrate runs after deploy and before the gate. During the gate window the old
production code is still `Current` and runs against the newly migrated schema, so
**expand-only migrations are required**. No down-migrations, no rollback. This
matches the no-automated-rollback decision.

## Removed

- `.github/workflows/post-deploy.yml` — the `migrate`, `rollback`, and debug
  `client_payload` steps all go.
- Vercel dashboard: the required `DB Migration` GitHub Actions check and the
  Repository Dispatch integration.
- `teardown.yml` and the `neon-db-url` action are kept and reused.

## Risks and mitigations

- **Neon provisioning on a CLI deploy.** The preview DB branch is created by the
  Neon-Vercel integration reacting to the deploy. A CLI deploy must still trigger
  it and carry `githubCommitRef`. Validate empirically. Fallback: create the
  branch with `neonctl branches create preview/<branch>` from the parent inside
  the workflow.
- **Current production is un-promoted right now.** The project reports
  `live: false`, the latest deployment is a `debug-oidc-claims` preview, and the
  custom domain returns 404. The first `main` run under this design deploys and
  promotes, which restores production. Or run one manual `vercel promote` of the
  last good build first.
- **CLI git metadata.** `--meta githubCommitRef` must be set or `teardown.yml`
  deletion-by-ref and Neon `preview/<branch>` naming both break.
- **Expand-only is now load-bearing.** With rollback removed, a
  non-backward-compatible migration can break the live old code during the gate
  window. Enforce in review.

## Secrets and vars

All reused, no new ones:

- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (as the CLI org scope),
  `NEON_API_KEY`, `NEON_PROJECT_ID`, `DEPLOYER_ROLE_ARN`, `AWS_ACCOUNT_ID`,
  `AWS_REGION`.
- The protection-bypass value comes from the Terraform output (Vercel also
  exposes it in deployments as `VERCEL_AUTOMATION_BYPASS_SECRET`).

## Future (out of scope)

- **Automated rollback after migrate/apply/e2e failure.** Must be a schema-only
  down-migration, not a Neon point-in-time restore, because PITR would lose any
  transactions written after the migration. Design the down path per migration.
- **Terraform config rollback.** Terraform has no native state rollback.
  Re-apply the last-good git sha, or restore a prior state file via S3 bucket
  versioning. The re-apply-old-sha path is the normal pattern.
- **Preview e2e gate.** Extend the seam to preview once the production gate is
  proven.

## Evidence

- `vercel/vercel` v5.15.1 `client/deployment.go`: `IsComplete()` = `AliasAssigned
  && AliasError == nil`; unbounded `for !IsComplete()` poll, `time.Sleep(5s)`, no
  timeout or `wait_for`. Create endpoint is `POST
  /v12/now/deployments?skipAutoDetectionConfirmation=1`.
- Vercel docs: `--skip-domain` + auto-assign-off produce a "Staged" production
  deployment; `vercel promote` / `POST /v10/projects/{id}/promote/{deploymentId}`
  mark it `Current` with no rebuild; Standard Protection covers production
  deployment URLs; bypass via `x-vercel-protection-bypass`.
- Drizzle `pg-core/dialect.js`: all pending migrations run inside one
  `session.transaction`.

## ADR update

Update **adr013 in place** after this design is implemented. Do not create a new
ADR. adr013's decision that Terraform is the sole deploy path and that the `DB
Migration` Deployment Check gates promotion is reversed here: the deployment
lifecycle moves to `deploy.yml` as a staged build-migrate-gate-promote flow.

Sequence:

1. Implement this design.
2. Run `/domain-model
   thoughts/designs/2026-09-11-staged-promote-deployment-gate.md` to amend adr013
   in place (rewrite Decision and Consequences, keep the same ADR number and
   file).
