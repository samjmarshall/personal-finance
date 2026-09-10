---
paths:
  - ".github/workflows/**"
---

# GitHub Actions

`repository_dispatch`, `schedule`, and `workflow_dispatch` triggers always run from the **default branch (`main`)** — not from the branch that triggered the event. A fix pushed to a feature branch will not take effect until it is merged into `main`. This is how GitHub Actions works by design.

`post-deploy.yml` is subject to this: it runs migrations as the `DB Migration` Deployment Check on `repository_dispatch: vercel.deployment.ready` (fired by Vercel's Repository Dispatch integration), so it always executes the copy on `main`, must exist on `main` to trigger at all, and a migration-workflow fix on a branch is invisible until merged. The branch that first adds it won't migrate its own preview — `make db_migrate` by hand until it lands on `main`.

`push` triggers (`deploy.yml`, `quality-control.yml`) run from the pushed branch, so a workflow fix is exercised by that branch's own preview deploy before merge. `deploy.yml` is the only deploy path — Vercel's git auto-deploy is off (`vercel.json`). Deploy by **branch name** (`TF_VAR_deploy_ref`), never the SHA: `teardown.yml` and the Neon `preview/<branch>` naming both key off Vercel's `meta.githubCommitRef`.
