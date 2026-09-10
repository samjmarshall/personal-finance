# Infrastructure

Terraform in `infrastructure/` owns the Vercel project, per-environment AWS IAM role (Bedrock via Vercel OIDC), the three Bedrock env vars and the Vercel deployment. `.github/workflows/deploy.yml` applies it on every push. Migrations run separately in `.github/workflows/post-deploy.yml`, fired by Vercel's `vercel.deployment.ready` dispatch as the `DB Migration` Deployment Check, which gates production promotion (Vercel holds the production alias until the migration passes). Decisions: [adr013](adr/adr013-terraform-owned-vercel-deployments.md), [adr014](adr/adr014-bedrock-via-vercel-oidc.md).

## Layout

| | production | preview |
| --- | --- | --- |
| State key | `personal-finance/production.tfstate` | `personal-finance/preview.tfstate` (shared by every branch) |
| Vercel project | owns `vercel_project` + `vercel_project_domain` | reads via `data.vercel_project` |
| IAM role | `personal-finance-production` | `personal-finance-preview` |
| Env vars (`target`) | `["production"]` | `["preview"]` |
| Deployment | `ref = main`, `production = true` | `ref = <branch>`, last apply wins |

State bucket `139035987018-terraform-state` (S3 lockfile locking). Both IdPs (`oidc.vercel.com/rekurve`, `token.actions.githubusercontent.com`) already exist in the account and are read, never created.

## Local use

```sh
assume <profile>                      # exports AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN
export VERCEL_API_TOKEN=<token>       # same value as the VERCEL_TOKEN GitHub secret
make plan env=preview                 # or env=production
make apply env=preview TF_VAR_deploy_ref=<branch> TF_VAR_deploy_sha=$(git rev-parse HEAD)
make fmt-check                        # CI gate (quality-control.yml)
make force-unlock env=preview ID=<id> # only after a killed apply left the lock
```

`make destroy` refuses `env=production`. Don't use it to clean up one branch — the preview state holds the role and env vars every live preview shares; `teardown.yml` handles a branch.

## Switch the receipt model

1. Confirm the new model has an `au.` inference profile and access is granted: `aws bedrock list-inference-profiles --region ap-southeast-2`.
2. Edit **both** locals in `infrastructure/locals.tf`: `bedrock_receipt_model` (the `au.` profile id the app calls) and `bedrock_foundation_model` (the bare id the IAM wildcard covers).
3. Push. `deploy.yml` applies the IAM policy and the `BEDROCK_RECEIPT_MODEL` env var, then redeploys. Nothing in `src/` changes; `src/env.js` only carries a default for local runs.

## Bootstrap (once, manual, in order)

0. **Verify assumptions.** `assume <profile>` then:
   - `aws sts get-caller-identity` → account `139035987018`.
   - `aws s3 ls s3://139035987018-terraform-state/` → bucket exists.
   - `aws iam list-open-id-connect-providers` → both IdPs listed.
   - `aws bedrock list-inference-profiles --region ap-southeast-2` → `au.anthropic.claude-sonnet-4-6`.
   - Vercel project → Settings → Security → OIDC issuer mode is *Team*. If not, step 4 sets it.
1. **Deployer role.** `aws cloudformation deploy --stack-name personal-finance-github-actions --template-file docs/cloudformation-templates/github-actions.yaml --capabilities CAPABILITY_IAM --parameter-overrides GitHubOidcProviderArn=arn:aws:iam::139035987018:oidc-provider/token.actions.githubusercontent.com`. Copy the `Role` output. (Done differently: the account's existing `github-actions` stack role, whose trust `sub` is `repo:samjmarshall/*`, was reused instead. Deploy the per-repo stack above when that trust should narrow to this repo.)
2. **GitHub.** Secret `DEPLOYER_ROLE_ARN` = that output. Vars `AWS_ACCOUNT_ID=139035987018`, `AWS_REGION=ap-southeast-2`. (`VERCEL_TOKEN`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` already exist.)
3. **Import production state** from this branch:
   ```sh
   make init env=production
   terraform -chdir=infrastructure import 'vercel_project.this[0]' team_EvSwX8U1lcuYut5eKZ9W00jY/prj_XBpWQBKeTYw9rnrNnPhdewVUBeGb
   terraform -chdir=infrastructure import 'vercel_project_domain.prod[0]' team_EvSwX8U1lcuYut5eKZ9W00jY/prj_XBpWQBKeTYw9rnrNnPhdewVUBeGb/finance.sammarshall.co
   make plan env=production
   ```
   Read the plan. `vercel_project.this[0]` must show **update in-place** (at most `oidc_token_config`), never replace — a replace drops every integration on the project. Adjust attributes in `vercel.tf` until it does.
4. **Apply production once locally**: `make apply env=production`. Creates the prod role + env vars and redeploys `main` (still on `ANTHROPIC_API_KEY`; harmless).
5. **Install the Vercel Repository Dispatch integration** and enable Deployment Checks: in the Vercel project add a **required** GitHub Actions check named exactly `DB Migration` (must match the `name` in `post-deploy.yml`'s status step) with automatic production aliasing left on. The integration fires `vercel.deployment.ready` on every Terraform-created deployment, which triggers `post-deploy.yml` (from `main`) to migrate the matching Neon branch; the check then gates production promotion. Because `repository_dispatch` runs the copy on `main`, the branch that first adds `post-deploy.yml` won't migrate its own preview — run `make db_migrate` by hand for that branch until it merges.
6. **Push the branch.** `deploy.yml` creates the preview role/env vars/deployment, then migrates `preview/<branch>`. `vercel.json` in the same commit stops Vercel's own git deploy for it.
7. **Merge** → production deploy on Bedrock.
8. After a production receipt processes: delete `ANTHROPIC_API_KEY` from Vercel. Flip adr013/adr014 to Accepted.

## Verify after cutover

- Actions: `deploy` green on the branch; the `Post-Deploy Migration` run (fired by `vercel.deployment.ready`) is green as the `DB Migration` check; `vercel inspect <url>` shows `githubCommitRef=<branch>`; Neon has `preview/<branch>`. On `main`, confirm Vercel holds the production alias until the check passes, then promotes.
- Preview app: upload a receipt → `process-receipt` succeeds. `AccessDenied` / `Could not load credentials` → check `AWS_ROLE_ARN` on the deployment and the role's trust `sub`.
- >4.5 MB PDF parks as "Receipt is too large to read", not "Retry in a moment".
- Second push to the branch: plan replaces only `terraform_data.deploy_sha` + `vercel_deployment.this`; the previous deployment stays live.
- Second branch: its apply must not remove the first branch's deployment.
- Local: `assume <profile>` + `make start` → extraction works with no `AWS_ROLE_ARN`.
- Break a migration on a preview branch → `rollback` resets the Neon branch to its parent.
- Close the PR → `teardown.yml` removes `preview/<branch>` and the preview deployments.
