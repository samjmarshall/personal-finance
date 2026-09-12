---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-12'
# prettier-ignore
---

# GitHub Actions runs a staged build→migrate→gate→promote deploy; Terraform is infrastructure-only

## Context

Two forces first pulled the deploy into Terraform (this ADR's original decision, 2026-09-09):

- Vercel's git integration auto-deployed every push, and migrations ran in `post-deploy.yml` on a `repository_dispatch` fired by Vercel's Repository Dispatch integration. `repository_dispatch` always runs the workflow from `main`, so a migration-workflow fix on a branch was invisible until merged, and the deploy→migrate ordering depended on a third-party integration we could not see into.
- Receipt extraction moved to Amazon Bedrock ([adr014](adr014-bedrock-via-vercel-oidc.md)), which needs a per-environment AWS IAM role whose trust policy names the Vercel project and environment, and a Vercel env var that names the role. Two systems that must agree on each other's identifiers want one owner.

That first design made Terraform own a `vercel_deployment` resource and gated production promotion on a `DB Migration` Vercel Deployment Check. **It deadlocked in production, every run.** The `vercel_deployment` resource (provider `vercel/vercel` v5.15.1) polls for the alias to be *assigned* with no timeout; with auto-aliasing on and the `DB Migration` check holding the production alias, the apply polled until the job hit its 25-minute cap and was cancelled. Re-runs stacked multiple deployments on one SHA, all writing the single `DB Migration` commit-status, so the check flapped and never settled. Terraform cannot create a *staged* (un-promoted) production deployment — turn auto-assign off and the alias never comes, so Create polls forever — and the provider has no promote resource. A real pre-promote gate therefore requires the deployment to leave Terraform.

Preview still has to survive intact: the Neon-Vercel integration names each preview database `preview/<branch>` from the deployment's `meta.githubCommitRef`, and `teardown.yml` deletes preview deployments by the same field. Who owns the deployment, and how do migrations sequence with promotion, without the alias-wait deadlock?

## Decision

Terraform owns **infrastructure only**; `.github/workflows/deploy.yml` owns the **deployment lifecycle** — build, migrate, gate, promote — as a pipeline of five dependent jobs (`terraform-apply` → `deploy` → `db-migration` → `health-check` → `promote`) on every push, so each stage is separately visible and re-runnable.

Terraform (`infrastructure/`) keeps the Vercel project and production domain, the per-environment IAM role, the three Bedrock env vars (`AWS_REGION`, `AWS_ROLE_ARN`, `BEDROCK_RECEIPT_MODEL`), and now a `vercel_project_protection_bypass` secret (production state only). The `vercel_deployment` resource and its SHA-keyed `terraform_data` are gone, and `auto_assign_custom_domains = false` so production builds stage instead of auto-aliasing. Vercel's own git deploys stay off (`vercel.json`).

The jobs run, per push: **terraform-apply** (infra only — no alias wait) → **deploy** via the Vercel CLI (production `--prod --skip-domain` to stage un-aliased; both stamp `--meta githubCommitRef=<branch>`) → **db-migration** (resolve the Neon branch, then `make db_migrate` unpooled in one Drizzle transaction). For production two more jobs follow: **health-check** gates the staged deployment by curling `/api/health` with the `x-vercel-protection-bypass` header (HTTP 200 against the freshly-migrated DB), and only then **promote** runs `vercel promote` to move the domain. Preview stops after db-migration — no gate, no promote.

There is no automated rollback. A failed migrate is one aborted transaction that leaves the schema unchanged and fails the job before promote, so the previous production deployment stays `Current`. Migrations are therefore expand-only: the old `Current` code runs against the new schema during the gate window. `post-deploy.yml`, the `DB Migration` Deployment Check, and the Repository Dispatch integration are all removed.

## Consequences

- No alias-wait deadlock: `terraform apply` is infra-only and returns in seconds; the CLI `vercel deploy` never blocks on alias assignment, and `vercel promote` moves the domain in one step while preserving Vercel's instant-rollback (`Current`) tracking.
- The gate runs against the real, migrated deployment before it takes the domain, so promoted production code and schema never diverge — the property the old `DB Migration` check was there to guarantee, now without a third-party integration or commit-status race.
- The whole flow is one `push` workflow we own, so a `deploy.yml` fix on a branch is exercised by that branch's own preview run — no more `repository_dispatch`-from-`main` blind spot.
- Rollback is manual and expand-only is load-bearing: a non-backward-compatible migration breaks the live old code during the gate window. Enforce expand-only in review; automated down-migrations are future work (see the design doc).
- One extra secret to manage: the `vercel_project_protection_bypass` value (production state only; preview has no gate). Because a GitHub Actions secret cannot cross a job boundary — GitHub scrubs secret-bearing job outputs to empty — the `health-check` job re-inits Terraform and re-reads it from state with `terraform output -raw` (masked) rather than taking it as an output from `terraform-apply`. Only non-secret values (`app_url`, `deployment_url`, the Neon `branch_id`) pass between jobs; the DB URL is likewise re-derived from `branch_id` in `db-migration`.
- `/api/health` is a new public, unauthenticated route running `select 1`; it discloses only DB up/down and is the seam a Playwright e2e gate later drops into.
- The deployment SHA and the run's SHA can still differ (branch-ref deploys build the branch head at CLI-deploy time); harmless under the per-branch, never-cancel concurrency group.
- Terraform still never deletes a deployment (`teardown.yml` handles preview cleanup; `terraform destroy` on preview state would strip the shared role/env vars for every live preview). Integration- and dashboard-managed secrets (Neon, Blob, Upstash, Better Auth, Inngest, Resend) stay outside Terraform; only the three Bedrock vars plus the bypass secret are managed. Bootstrap still imports the existing project/domain and reads the first plan carefully to avoid a project *replace*.
- The deployer role still carries broad access and its trust covers every ref of the repo (any branch push runs `apply`); acceptable for a single-owner repo, split per environment when a second contributor arrives.

## Links

- Related: [adr014](adr014-bedrock-via-vercel-oidc.md) — the Bedrock role this wiring exists to deliver
- Design: [staged production deploys with a promote gate](../../thoughts/designs/2026-09-11-staged-promote-deployment-gate.md)
- Runbook: [infrastructure](../infrastructure.md) — bootstrap, cutover, model switch
- Implements: `infrastructure/`, `.github/workflows/deploy.yml`, `src/app/api/health/route.ts`, `vercel.json`
