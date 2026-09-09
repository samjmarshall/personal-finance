---
paths:
  - ".github/workflows/teardown.yml"
  - "scripts/neon-branch.sh"
  - "infrastructure/**"
---

# Preview teardown

`teardown.yml` explains itself — step names + comments cover order, the skip gate, the Vercel match, and why there's no Inngest step. Read it. Only the below isn't visible there.

**Terraform deploys, never deletes.** `infrastructure/` creates preview deployments (one shared `preview.tfstate`, last apply wins) but every `vercel_deployment` is `delete_on_destroy = false`, and the `preview/<branch>` Neon branch is still made by the Neon-Vercel integration, not Terraform. Teardown stays targeted API deletes by branch name. Never reach for `terraform destroy` to clean up a branch — the preview state holds the role + env vars every live preview shares, so destroying it breaks all of them (`make destroy` refuses production and exists only for a full preview reset).

**`local/` prefix is a cross-file coupling.** `teardown.yml:47` deletes `local/<branch>` Neon branches. Those come from `scripts/neon-branch.sh` (`PREFIX="local"`). Rename it there → branches orphan silently.

**New steps need the skip guard.** Any cleanup step you add must carry `if: steps.skip.outputs.skip != 'true'`. Without it, the `delete` trigger re-runs it after the PR event already cleaned up.
