---
paths:
  - package.json
---

Production dependencies must be pinned to a specific version (no `^` or `~` ranges) to avoid drift. Dev dependencies may use ranges, but the lockfile must be committed and kept up-to-date.
