# Staged Production Deploys with a Promote Gate — Implementation Plan

## Context

The `DB Migration` Vercel Deployment Check that gated production promotion gets
stuck "pending": the `vercel_deployment` provider resource polls for the alias to
be *assigned* with no timeout, so with the check holding the production alias the
deploy job runs to its 25-minute cap and is cancelled. Terraform cannot create a
staged (un-promoted) production deployment, so the deployment lifecycle must leave
Terraform. This plan moves build/migrate/gate/promote into `deploy.yml` as a
staged flow and keeps Terraform to infrastructure only.

## Current State

- `deploy.yml` is the sole deploy path: `terraform apply` creates the Vercel
  deployment and publishes `app_url` as the GitHub environment URL
  (`.github/workflows/deploy.yml:63-67`), passing `TF_VAR_deploy_ref` /
  `TF_VAR_deploy_sha` (`deploy.yml:41-42`). No Node/pnpm setup in this job.
- Terraform owns a `vercel_deployment.this` + `terraform_data.deploy_sha` pair
  (`infrastructure/vercel.tf:84-109`) and keeps auto-aliasing on
  (`vercel.tf:27` `auto_assign_custom_domains = true`).
- `app_url` output references the deployment resource for preview
  (`infrastructure/outputs.tf:13`).
- `deploy_ref` / `deploy_sha` variables feed only that resource
  (`infrastructure/variables.tf:11-21`).
- Migrations run in `post-deploy.yml` on a `vercel.deployment.ready`
  `repository_dispatch` (`.github/workflows/post-deploy.yml:9-12`), reporting the
  `DB Migration` check (`post-deploy.yml:34-37`), running `db:check` then
  `db:migrate` unpooled (`post-deploy.yml:101-112`), with a Neon rollback job
  (`post-deploy.yml:117-156`).
- Neon branch → connection URIs already factored into a composite action
  (`.github/actions/neon-db-url/action.yml`); branch-resolution logic lives in
  `post-deploy.yml:59-85`.
- DB client is a module-scope `postgres()` (lazy connect) + drizzle
  (`src/server/db/index.ts:38-41`); `db` is safely imported at module scope in a
  route today (`src/app/api/receipts/inbound/route.ts:5`).
- `drizzle-kit migrate` reads `DATABASE_URL_UNPOOLED ?? DATABASE_URL`
  (`drizzle.config.ts:13`); `DATABASE_URL_UNPOOLED` is optional in env
  (`src/env.js:47`).
- No `src/app/api/health/` route exists. Plain-`Request`/`Response` route +
  colocated test precedent: `src/app/api/receipts/inbound/route.ts:40-51` and
  `route.test.ts`.
- Runbook documents the old flow (`docs/infrastructure.md:55`, `:62`).
- `adr013` is `Status: 'Accepted'` (`docs/adr/adr013-terraform-owned-vercel-deployments.md:2`).
- Installed provider is `vercel/vercel` v5.15.1; it exposes
  `vercel_project_protection_bypass` with a computed sensitive attribute
  `protection_bypass_for_automation_secret` (confirmed in the provider binary).

## Desired End State

- Terraform applies fast (infra only: project, prod domain, IAM role, 3 Bedrock
  env vars, protection-bypass secret) — no deployment resource, no alias wait.
- Every push runs one `deploy.yml`: `terraform apply` → `vercel deploy` (CLI) →
  resolve Neon branch → `db_check` + `db_migrate` (unpooled) → **production only**:
  gate `/api/health` behind the bypass header, then `vercel promote`.
- Preview just deploys and migrates (no gate/promote).
- `post-deploy.yml`, the `DB Migration` check, and the Repository Dispatch
  integration are gone: no `repository_dispatch`, no commit-status race, no
  alias-wait deadlock.
- A failed migrate (one Drizzle transaction) fails the job before promote; the
  previous production deployment stays `Current`. No automated rollback.
- `GET /api/health` returns 200 with a `select 1` readiness check.

## Out of Scope

- Automated rollback after migrate/apply/e2e failure (future; must be a
  schema-only down-migration).
- Terraform config/state rollback.
- Preview e2e gate (extend the seam once the production gate is proven).
- Creating a new ADR. `adr013` is amended **in place after implementation** via
  `/domain-model` (see References) — not part of these phases.

## Approach

Land the gate seam first (a tiny health route with a unit test), then flip
Terraform to infrastructure-only and add the protection-bypass secret, then
rewrite `deploy.yml` into the staged build-migrate-gate-promote flow and delete
`post-deploy.yml`. Phases 2 and 3 are one production cutover and must ship on the
same branch: that branch's own preview run exercises the new infra apply + CLI
deploy + migrate before merge; the production gate + promote are first exercised
on the `main` run. Migrations are expand-only (old `Current` code runs against the
new schema during the gate window).

## Phase 1: Health gate route

### Changes

- `src/app/api/health/route.ts` — new. `export const dynamic = "force-dynamic"`
  (do not evaluate/cache at build); `export async function GET(): Promise<Response>`
  runs `await db.execute(sql`select 1`)` and returns `Response.json({ status: "ok" },
  { status: 200 })`; on a thrown error logs `console.error` and returns
  `Response.json({ status: "error" }, { status: 503 })`. Plain `Response`, no auth
  on the route. Imports `db` from `~/server/db` and `sql` from `drizzle-orm`,
  mirroring the module-scope `db` import at `src/app/api/receipts/inbound/route.ts:5`.
- `src/app/api/health/route.test.ts` — new, colocated. Mock `~/server/db` with a
  fake `{ execute }` (pattern from `src/app/api/receipts/inbound/route.test.ts:13`).
  Tests: (1) `execute` resolves → 200 and body `{ status: "ok" }`; (2) `execute`
  rejects → 503 and `console.error` called (spy it). TDD one-test-then-impl per the
  `tdd` skill.

### Success

- [x] `make check` passes
- [x] `make test` passes (both health-route cases green)
- [x] `curl -s -o /dev/null -w '%{http_code}' https://personal-finance.localhost/api/health` returns `200` against `make start`
- [x] `GET /api/health` returns 503 when the DB is unreachable (observable: point at a bad `DATABASE_URL` locally)

## Phase 2: Terraform infrastructure-only + protection-bypass secret

### Changes

- `infrastructure/vercel.tf` — delete `resource "vercel_deployment" "this"`
  (`vercel.tf:95-109`) and `resource "terraform_data" "deploy_sha"`
  (`vercel.tf:87-89`) with their comment block (`vercel.tf:84-94`). Set
  `auto_assign_custom_domains = false` (`vercel.tf:27`) and update the comment: the
  project now stages instead of auto-aliasing; promotion is done by `deploy.yml`.
  Add `resource "vercel_project_protection_bypass" "this"` with
  `count = local.is_prod ? 1 : 0` and `project_id = local.vercel_project_id` (the
  single project is owned by the production state, so the secret is prod-state only;
  preview reads the project via `data.vercel_project` and needs no bypass — it has
  no gate).
- `infrastructure/outputs.tf` — rewrite `app_url` (`outputs.tf:11-14`) to
  `value = "https://${local.prod_domain}"` (drop the removed
  `vercel_deployment.this.url` reference). Add:
  `output "protection_bypass_secret" { sensitive = true; value =
  one(vercel_project_protection_bypass.this[*].protection_bypass_for_automation_secret) }`
  (`one()` yields the value in prod state and `null` in preview state, which never
  reads it).
- `infrastructure/variables.tf` — delete the now-unused `deploy_ref`
  (`variables.tf:11-15`) and `deploy_sha` (`variables.tf:17-21`) variables.
- No test file — Terraform config has no unit harness here; validated via `plan`.

### Success

- [x] `make fmt-check` passes
- [x] (CI-only — local init has no AWS S3-backend creds) `make plan env=production` succeeds and shows: `vercel_deployment.this` +
      `terraform_data.deploy_sha` **destroyed**, `vercel_project_protection_bypass.this`
      **created**, `vercel_project.this` updated (`auto_assign_custom_domains false`),
      no reference errors
- [ ] `make plan env=preview` succeeds with no reference errors (no bypass resource
      in preview state)
- [x] `terraform -chdir=infrastructure output -raw protection_bypass_secret` returns a
      non-empty value after a production apply (verified during Phase 3 rollout)

## Phase 3: deploy.yml staged flow; remove post-deploy.yml

### Changes

- `.github/workflows/deploy.yml` — rewrite the single `deploy` job. Update the
  header comment (drop the `post-deploy.yml` / `DB Migration` narrative,
  `deploy.yml:3-8`). Remove `TF_VAR_deploy_ref` / `TF_VAR_deploy_sha`
  (`deploy.yml:41-42`). Add pnpm (`pnpm/action-setup@v4`) + Node
  (`actions/setup-node@v6`, `node-version-file: .nvmrc`, `cache: pnpm`) +
  `make install`, mirroring `quality-control.yml:13-20`. Steps, in order:
  1. **Terraform apply** — keep `make apply env="$ENVIRONMENT"` (`deploy.yml:63-66`).
     For production also read `terraform -chdir=infrastructure output -raw
     protection_bypass_secret` into a masked step output (`::add-mask::`).
  2. **Vercel deploy (CLI)** — set `VERCEL_ORG_ID=${{ secrets.VERCEL_TEAM_ID }}`,
     `VERCEL_PROJECT_ID=${{ secrets.VERCEL_PROJECT_ID }}`; run
     `pnpm dlx vercel@<pinned> deploy --token=$VERCEL_TOKEN
     --meta githubCommitRef=$REF --meta githubCommitSha=$SHA` plus `--prod
     --skip-domain` for production. Capture stdout as `deployment_url`.
  3. **Resolve Neon branch** — port `post-deploy.yml:59-85` (production → primary
     branch; preview → `preview/<ref>`), wrapped in a bounded poll loop (the CLI
     deploy triggers Neon provisioning, so the preview branch may not exist yet):
     retry the branches API up to a timeout, fail loud on exhaustion. Emit the
     non-secret `branch_id` only.
  4. **Resolve DB URLs** — `uses: ./.github/actions/neon-db-url` with
     `branch_id` (unchanged action).
  5. **DB check + migrate** — `make db_check` then `make db_migrate`, env
     `SKIP_ENV_VALIDATION: 1` and `DATABASE_URL_UNPOOLED: <step db_url_unpooled>`
     (matches `post-deploy.yml:101-112`). One transaction: any failure fails the
     job before gate/promote.
  6. **Gate (production only)** —
     `curl -fsS -o /dev/null -w '%{http_code}' -H "x-vercel-protection-bypass:
     $BYPASS" "$deployment_url/api/health"`, assert `200`; non-200 fails the job.
  7. **Promote (production only)** — `pnpm dlx vercel@<pinned> promote
     "$deployment_url" --token=$VERCEL_TOKEN --yes`.
  - **Environment URL**: production → `terraform output -raw app_url` (custom
    domain, reachable post-promote; the staged URL is behind SSO); preview →
    `deployment_url` from step 2.
- `.github/workflows/post-deploy.yml` — **delete** the file (migrate + rollback +
  debug `client_payload` all go).
- `docs/infrastructure.md` — update the bootstrap/verification steps that describe
  the `DB Migration` check + Repository Dispatch integration (`:55`, `:62`) to the
  staged flow; note the manual Vercel-dashboard removal (below).
- **Manual (not code)** — in the Vercel dashboard, remove the required
  `DB Migration` GitHub Actions check and uninstall the Repository Dispatch
  integration. Captured as a success item; it cannot be a `make` target.
- No workflow unit test (no harness); validated by the branch's own run.

### Success

- [x] `make check` passes; `make test` passes (unaffected)
- [x] `make fmt-check` passes (Terraform untouched here but CI runs it)
- [ ] Branch preview run of `deploy.yml` is green end to end: Terraform apply, CLI
      deploy, Neon branch resolved, `db_migrate` applied to `preview/<branch>` — no
      gate/promote on preview
- [x] `main` run is green through gate + promote; the staged deployment is marked
      `Current` and `https://finance.sammarshall.co/api/health` returns 200
- [x] `post-deploy.yml` is deleted and no `repository_dispatch` workflow remains
- [x] Vercel dashboard: `DB Migration` required check and Repository Dispatch
      integration removed (manual)
- [x] `/security-review` (handles the protection-bypass secret, OIDC deploy
      credentials, production promote, and removal of the migration gate)

## Rollout notes

- Ship Phases 2 + 3 on one branch. Production is currently un-promoted
  (`live: false`, custom domain 404): the first `main` run under this design
  deploys + promotes and restores it. Alternatively run one manual
  `vercel promote <last-good-url> --yes` before merge.
- `--meta githubCommitRef` must be set on the CLI deploy or `teardown.yml`
  deletion-by-ref and Neon `preview/<branch>` naming both break.
- Migrations are expand-only from here (rollback removed): a non-backward-compatible
  migration breaks the live old code during the gate window. Enforce in review.
- Contingency (only if the Neon poll proves flaky empirically): create the preview
  branch explicitly with `neonctl branches create preview/<branch>` from the parent
  inside the workflow before resolving URLs.

## References

- Design doc: `thoughts/designs/2026-09-11-staged-promote-deployment-gate.md`
  (frontmatter: amends adr013 in place after implementation; no new ADR)
- ADR to amend **after** implementation: `docs/adr/adr013-terraform-owned-vercel-deployments.md`
  (`Accepted`) — run `/domain-model thoughts/designs/2026-09-11-staged-promote-deployment-gate.md`
  to rewrite its Decision + Consequences in place (same number/file). Not a phase here.
- Provider: `vercel/vercel` v5.15.1 — `vercel_project_protection_bypass`
  (`protection_bypass_for_automation_secret`, computed + sensitive).
- Prior art: `.github/workflows/post-deploy.yml:59-112` (branch resolve + migrate),
  `.github/actions/neon-db-url/action.yml`, `.github/workflows/quality-control.yml:13-20`
  (pnpm/node setup), `src/app/api/receipts/inbound/route.ts` + `route.test.ts`
  (plain Request/Response route + colocated test).
- Runbook to update: `docs/infrastructure.md:55,62`.
