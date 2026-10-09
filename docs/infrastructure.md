# Infrastructure

Terraform in `infrastructure/` owns infrastructure only: the Vercel project, per-environment AWS IAM role (Bedrock via Vercel OIDC), the app env vars it sets on Vercel (`local.vercel_env` in `vercel.tf`: Bedrock, token prices, PostHog), the production protection-bypass secret and PostHog alerting config (the AI cost insight and alert, and the test-users cohort; production state only). `.github/workflows/deploy.yml` runs the whole deploy on every push as one staged flow: terraform apply → `vercel deploy` (CLI, un-aliased) → resolve the Neon DB branch → migrate (unpooled). For `main` it then gates the staged deployment on `/api/health` behind the bypass header and only then `vercel promote`s it onto the domain, so the alias never lands on an un-migrated build. A failed migrate fails the job before promote; the previous deployment stays `Current` (no automated rollback — migrations are expand-only). On branches a parallel `Production Plan` job also runs `terraform plan` against production state and posts the diff on the open PR (tfcmt), so a merge's production change is reviewed before `main` applies it. Decisions: [adr013](adr/adr013-terraform-owned-vercel-deployments.md), [adr014](adr/adr014-bedrock-via-vercel-oidc.md).

## Layout

| | production | preview |
| --- | --- | --- |
| State key | `personal-finance/production.tfstate` | `personal-finance/preview.tfstate` (shared by every branch) |
| Vercel project | owns `vercel_project` + `vercel_project_domain` | reads via `data.vercel_project` |
| IAM role | `personal-finance-production` | `personal-finance-preview` |
| Env vars (`target`) | `["production"]` | `["preview"]` |
| Deployment | `ref = main`, `production = true` | `ref = <branch>`, last apply wins |
| PostHog | owns `posthog_insight` + `posthog_alert` + `posthog_cohort` (imported) | none; the provider is still configured, so the key is still needed |

State bucket `139035987018-terraform-state` (S3 lockfile locking). Both IdPs (`oidc.vercel.com/rekurve`, `token.actions.githubusercontent.com`) already exist in the account and are read, never created.

## Local use

```sh
assume <profile>                      # exports AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN
export VERCEL_API_TOKEN=<token>       # same value as the VERCEL_TOKEN GitHub secret
export POSTHOG_API_KEY=<key>          # same value as the POSTHOG_PERSONAL_API_KEY GitHub secret; personal key, project 609915 only
make plan env=preview                 # or env=production
make apply env=preview TF_VAR_deploy_ref=<branch> TF_VAR_deploy_sha=$(git rev-parse HEAD)
make fmt-check                        # CI gate (quality-control.yml)
make force-unlock env=preview ID=<id> # only after a killed apply left the lock
```

`make destroy` refuses `env=production`. Don't use it to clean up one branch — the preview state holds the role and env vars every live preview shares; `teardown.yml` handles a branch.

## Switch the receipt model

1. Confirm the new model has an `au.` inference profile and access is granted: `aws bedrock list-inference-profiles --region ap-southeast-2`.
2. Edit **both** locals in `infrastructure/locals.tf`: `bedrock_receipt_model` (the `au.` profile id the app calls) and `bedrock_foundation_model` (the bare id the IAM wildcard covers).
3. Set `bedrock_pricing_model_name` in the same file to the model's AWS Price List display name (e.g. `Claude Sonnet 4.6`). List the names with `aws pricing get-attribute-values --region us-east-1 --service-code AmazonBedrockFoundationModels --attribute-name model`. `pricing.tf` reads the `au.` geographic-tier price (about 10% over Global). If the name doesn't match exactly one row, `make plan` fails rather than shipping a wrong price.
4. Push. `deploy.yml` applies the IAM policy and the `BEDROCK_RECEIPT_MODEL` and `BEDROCK_*_TOKEN_PRICE_USD` env vars, then redeploys. Nothing in `src/` changes; `src/env.ts` only carries a default for local runs.

## PostHog config

`infrastructure/posthog.tf` owns the "AI cost per day (USD)" insight, the alert that emails the owner once today's AI cost passes `ai_daily_cost_alert_usd` (checked hourly), and the "Internal / Test users" cohort (`570363`, imported; the project's test-account filters point at it). Days are UTC (the project timezone).

A PostHog UI edit to a field Terraform sets is reverted by the next `main` apply; UI-only extras (e.g. chart options, dashboard pins) can stick. Change it in `infrastructure/posthog.tf` or `infrastructure/locals.tf` instead. Everything else in the project (starter dashboard, project settings, GeoIP transformation) stays hand-managed.

## Bootstrap (once, manual, in order)

0. **Verify assumptions.** `assume <profile>` then:
   - `aws sts get-caller-identity` → account `139035987018`.
   - `aws s3 ls s3://139035987018-terraform-state/` → bucket exists.
   - `aws iam list-open-id-connect-providers` → both IdPs listed.
   - `aws bedrock list-inference-profiles --region ap-southeast-2` → `au.anthropic.claude-sonnet-4-6`.
   - Vercel project → Settings → Security → OIDC issuer mode is *Team*. If not, step 4 sets it.
1. **Deployer role.** `aws cloudformation deploy --stack-name personal-finance-github-actions --template-file docs/cloudformation-templates/github-actions.yaml --capabilities CAPABILITY_IAM --parameter-overrides GitHubOidcProviderArn=arn:aws:iam::139035987018:oidc-provider/token.actions.githubusercontent.com`. Copy the `Role` output. (Done differently: the account's existing `github-actions` stack role, whose trust `sub` is `repo:samjmarshall/*`, was reused instead. Deploy the per-repo stack above when that trust should narrow to this repo.)
2. **GitHub.** Secret `DEPLOYER_ROLE_ARN` = that output. Vars `AWS_ACCOUNT_ID=139035987018`, `AWS_REGION=ap-southeast-2`. (`VERCEL_TOKEN`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` already exist.) Secret `POSTHOG_PERSONAL_API_KEY`: a PostHog personal API key limited to project 609915, with write access to insights, alerts and cohorts.
3. **Import production state** from this branch:
   ```sh
   make init env=production
   terraform -chdir=infrastructure import 'vercel_project.this[0]' team_EvSwX8U1lcuYut5eKZ9W00jY/prj_XBpWQBKeTYw9rnrNnPhdewVUBeGb
   terraform -chdir=infrastructure import 'vercel_project_domain.prod[0]' team_EvSwX8U1lcuYut5eKZ9W00jY/prj_XBpWQBKeTYw9rnrNnPhdewVUBeGb/finance.sammarshall.co
   make plan env=production
   ```
   Read the plan. `vercel_project.this[0]` must show **update in-place** (at most `oidc_token_config`), never replace — a replace drops every integration on the project. Adjust attributes in `vercel.tf` until it does.
4. **Apply production once locally**: `make apply env=production`. Creates the prod role + env vars and redeploys `main` (still on `ANTHROPIC_API_KEY`; harmless).
5. **Turn off dashboard gating (one-time, manual).** The gate now lives in `deploy.yml`, not Vercel: remove the **required** `DB Migration` GitHub Actions check and uninstall the **Repository Dispatch** integration from the Vercel project. `auto_assign_custom_domains = false` (set in `vercel.tf`) leaves production deployments un-aliased so `deploy.yml` can gate then `vercel promote` them. Nothing here fires `vercel.deployment.ready` anymore.
6. **Push the branch.** `deploy.yml` applies the preview role/env vars, `vercel deploy`s (CLI, un-aliased), resolves `preview/<branch>`, and migrates it — no gate/promote on preview. `vercel.json` in the same commit stops Vercel's own git deploy for it.
7. **Merge** → the `main` run deploys on Bedrock, gates `/api/health` behind the bypass header, then promotes onto `finance.sammarshall.co`.
8. After a production receipt processes: delete `ANTHROPIC_API_KEY` from Vercel. Flip adr013/adr014 to Accepted.

## Verify after cutover

- Actions: `deploy` green on the branch — apply, `vercel deploy`, Neon branch resolved, `db_migrate` applied to `preview/<branch>` (no gate/promote on preview); `vercel inspect <url>` shows `githubCommitRef=<branch>`; Neon has `preview/<branch>`. On `main`, confirm the health gate passes, `vercel promote` marks the staged deployment `Current`, and `https://finance.sammarshall.co/api/health` returns 200.
- Preview app: upload a receipt → `process-receipt` succeeds. `AccessDenied` / `Could not load credentials` → check `AWS_ROLE_ARN` on the deployment and the role's trust `sub`.
- >4.5 MB PDF parks as "Receipt is too large to read", not "Retry in a moment".
- Second push to the branch: a fresh `vercel deploy` ships; Terraform apply is infra-only and no-ops. The previous deployment stays live.
- Second branch: its apply touches only shared preview infra, never another branch's deployment.
- Local: `assume <profile>` + `make start` → extraction works with no `AWS_ROLE_ARN`.
- Break a migration on a preview branch → the job fails at `db_migrate`, before any promote. No automated rollback — migrations are expand-only (fix forward).
- Close the PR → `teardown.yml` removes `preview/<branch>` and the preview deployments.
