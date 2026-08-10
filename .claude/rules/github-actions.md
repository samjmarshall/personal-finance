---
paths:
  - ".github/workflows/**"
---

# GitHub Actions

`repository_dispatch`, `schedule`, and `workflow_dispatch` triggers always run from the **default branch (`main`)** — not from the branch that triggered the event. A fix pushed to a feature branch will not take effect until it is merged into `main`. This is how GitHub Actions works by design (see `.github/workflows/quality-control.yml:48` for the existing `repository_dispatch` usage).
