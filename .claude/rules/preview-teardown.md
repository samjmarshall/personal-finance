---
paths:
  - ".github/workflows/teardown.yml"
  - "scripts/neon-branch.sh"
  - "infrastructure/**"
---

# Preview teardown

`teardown.yml` explains itself — step names + comments cover order, the skip gate, the Vercel match, and why there's no Inngest step. Read it. Only the below isn't visible there.

**Terraform deploys, never deletes.** `infrastructure/` creates preview deployments (one shared `preview.tfstate`, last apply wins) but every `vercel_deployment` is `delete_on_destroy = false`, and the `preview/<branch>` Neon branch is still made by the Neon-Vercel integration, not Terraform. Teardown stays targeted API deletes by branch name. Never reach for `terraform destroy` to clean up a branch — the preview state holds the role + env vars every live preview shares, so destroying it breaks all of them (`make destroy` refuses production and exists only for a full preview reset).

**`local/` and `preview/` are a cross-file coupling.** They name the Neon branches and, since adr028, the Blob pathname prefixes too. `scripts/neon-branch.sh` (`PREFIX="local"`) and `deploy.yml` set them, `teardown.yml` deletes both by them ("Delete local Neon Branch", "Delete branch blobs"), and `src/server/blob-store/blob-prefix.ts` decides which files a branch owns by them. Rename one → branches or files orphan silently.

**New steps need the skip guard.** Any cleanup step you add must carry `if: steps.skip.outputs.skip != 'true'`. Without it, the `delete` trigger re-runs it after the PR event already cleaned up.
