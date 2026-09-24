---
description: Review, groom, and schedule GitHub Project issues for PMF alignment
skills: roadmap-review
model: opus
effort: xhigh
---

# Roadmap Review

Use and follow the roadmap-review skill exactly as written.

## Pre-fetch GitHub Project Data

Before starting, fetch the live board, the completed-work corpus (for staleness detection), and the current timeline values (so the apply step knows what to clear):

```bash
# Live board: open issues + project fields
gh project item-list 2 --owner samjmarshall --format json --limit 200
gh project field-list 2 --owner samjmarshall --format json
gh issue list --repo samjmarshall/personal-finance --state all --json number,title,state,createdAt,updatedAt,milestone,labels --limit 200

# Completed-work corpus (~6 months) — comparison set for "superseded by shipped work"
gh issue list --repo samjmarshall/personal-finance --state closed --json number,title,closedAt,labels --limit 200
gh pr list   --repo samjmarshall/personal-finance --state merged --json number,title,mergedAt,files   --limit 200
git log --since="6 months ago" --oneline
```

The `item-list` JSON already carries each item's current Start date / Target date / Iteration — note which issues have them set, so the scheduling apply step can clear stale values.

## Context to Read

- `thoughts/docs/` — strategy, messaging, pilot feedback
- `thoughts/designs/` + `docs/adr/` — recent decisions and pivots (which areas changed)

## Then Begin the Review

Follow the skill's flow:

1. **Health pass** — groom open issues into Remove / Needs-investigation / Ready (evidence-based; `uncertain` → Needs-investigation; clean-pass = assumed Ready).
2. **Discovery** — capacity, blockers, leads, time off, and the WIP limit (Ready survivors only).
3. **Prioritize + schedule** — sequence Active Now, then compute Start/Target dates from Size + weekly hours + WIP.
4. Propose changes section by section.

## Output

Write the final approved roadmap prioritization to:
`thoughts/roadmap/YYYY-MM-DD-roadmap-prioritization.md`

**STOP after writing — make no GitHub changes.** The founder reviews, then directs the `github-project` agent to apply (close Removes, set/clear Start/Target dates, move milestones, drop iterations) and uses `/write-tickets` for Needs-investigation items.
