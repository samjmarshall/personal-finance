---
Status: 'Accepted'
Deciders: 'Sam Marshall'
Date: '2026-09-09'
# prettier-ignore
---

# Terraform owns the Vercel deployment; GitHub Actions applies on every push, then migrates

## Context

Vercel's git integration auto-deployed every push, and database migrations ran in `post-deploy.yml` on a `repository_dispatch` fired by Vercel's Repository Dispatch integration once the deployment was live. Two forces made that arrangement wear thin:

- `repository_dispatch` always runs the workflow from `main`, so a migration-workflow fix on a branch was invisible until merged, and the deploy→migrate ordering depended on a third-party integration we could not see into.
- Receipt extraction moved to Amazon Bedrock ([adr014](adr014-bedrock-via-vercel-oidc.md)). That needs a per-environment AWS IAM role whose trust policy names the Vercel project and environment, and a Vercel env var that names the role. Two systems that must agree on each other's identifiers want one owner.

Vercel's preview model also has to survive: the Neon-Vercel integration names each preview database `preview/<branch>` from the deployment's `meta.githubCommitRef`, and `teardown.yml` deletes preview deployments by the same field. Which system owns the deployment and the Vercel↔AWS wiring, and how do migrations sequence with it?

## Decision

We will make `terraform apply`, run by `.github/workflows/deploy.yml` on every push, the sole deploy path. Terraform (`infrastructure/`) owns the Vercel project and production domain, the per-environment IAM role, the three Bedrock env vars (`AWS_REGION`, `AWS_ROLE_ARN`, `BEDROCK_RECEIPT_MODEL`) and a `vercel_deployment` resource. Vercel's own git deploys are switched off with `vercel.json` (`git.deploymentEnabled: false`), while the Repository Dispatch integration stays installed to fire the migration Deployment Check below.

The deployment is created by **branch ref**, not commit SHA, so Vercel stamps `meta.githubCommitRef=<branch>` and the Neon naming and teardown matching keep working unchanged; a `terraform_data` resource keyed on the pushed SHA forces a fresh deployment per push through `replace_triggered_by`. There are two states: `production.tfstate` owns the project; one shared `preview.tfstate` reads the project through a data source and is applied by every non-`main` branch (last apply wins, `-lock-timeout=10m` so concurrent pushes queue). Every deployment is `delete_on_destroy = false`.

Migrations do **not** run in `deploy.yml`. They run in `post-deploy.yml`, triggered by Vercel's `vercel.deployment.ready` `repository_dispatch` once a deployment is built but not yet promoted. That workflow reports itself as the `DB Migration` Deployment Check (via `vercel/repository-dispatch/actions/status@v1`), so Vercel holds the production alias until the migration passes and only then promotes — the schema never lags promoted code. The migrate and rollback jobs are the previous ones, restored unchanged. Deployment Checks are enabled in the Vercel dashboard; the Terraform provider has no resource for them.

## Consequences

- The deploy step is a `push` workflow we own; a `deploy.yml` fix pushed to a branch is exercised by that branch's own preview run.
- Migrations gate promotion: a failed `DB Migration` check leaves the previous production deployment live, so production schema never lags promoted code. The trade-off is that `post-deploy.yml` runs on `repository_dispatch`, which always executes the copy on `main` — a migration-workflow fix on a branch is invisible until merged, and the file must exist on `main` to trigger at all. Accepted as the price of gating on the real Vercel deployment-ready signal.
- Terraform never deletes a deployment. Preview cleanup is still `teardown.yml`'s targeted API deletes; production keeps Vercel's instant rollback to earlier deployments. `terraform destroy` on the preview state would remove the shared role and env vars for every live preview, so it is not a per-branch tool.
- Deploying by branch ref means Vercel builds the branch head at apply time. A push racing an in-flight apply can deploy the newer commit under the older run; harmless, because the concurrency group is per branch and never cancels, but the run's SHA and the deployment's SHA can differ.
- Integration-injected and dashboard-managed secrets (Neon, Blob, Upstash, Better Auth, Inngest, Resend) stay outside Terraform; only the three Bedrock vars are managed.
- Bootstrap must import the existing project and domain into the production state and read the first plan carefully — a wrong `vercel_project` attribute plans a project *replace*, which would drop every integration on it.
- The deployer role carries `AdministratorAccess` (as in the reference stack) because Terraform creates IAM roles and policies, and its trust covers every ref of the repo, so any branch push runs `apply` with it. Acceptable for a single-owner repo; when a second contributor arrives, split the trust per GitHub environment (`sub: repo:…:environment:Production|Preview`), add a `main`-only deployment-branch rule on `Production`, and put a permissions boundary on what Terraform may create.
- The only way to redeploy is to push or re-run the workflow; there is no dashboard "Redeploy" that Terraform state knows about.

## Links

- Related: [adr014](adr014-bedrock-via-vercel-oidc.md) — the Bedrock role this wiring exists to deliver
- Runbook: [infrastructure](../infrastructure.md) — bootstrap, cutover, model switch
- Implements: `infrastructure/`, `.github/workflows/deploy.yml`, `.github/workflows/post-deploy.yml`, `vercel.json`
