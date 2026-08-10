---
paths:
  - ".github/workflows/teardown.yml"
  - "scripts/neon-branch.sh"
---

# Preview teardown

`teardown.yml` explains itself — step names + comments cover order, the skip gate, the Vercel match, and why there's no Inngest step. Read it. Only the below isn't visible there.

**No IaC.** This repo never creates preview resources — Neon-Vercel + Vercel git integration do. Teardown is API calls only. There's no Terraform to destroy. Don't add one.

**`local/` prefix is a cross-file coupling.** `teardown.yml:47` deletes `local/<branch>` Neon branches. Those come from `scripts/neon-branch.sh` (`PREFIX="local"`). Rename it there → branches orphan silently.

**New steps need the skip guard.** Any cleanup step you add must carry `if: steps.skip.outputs.skip != 'true'`. Without it, the `delete` trigger re-runs it after the PR event already cleaned up.
