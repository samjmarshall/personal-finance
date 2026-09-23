---
description: Implement the Code Review findings and Design smells from the Validation Report above, one at a time — each shown as a real applied diff, pausing for your keep / revise / revert decision.
model: opus
effort: high
---

Work through the **actionable** Code Review Findings and Design smells in the Validation Report above. One finding at a time. For each: write the real fix into the working tree, show me the diff, stop.

I review code, not proposals. Never describe a change you could have written.

## Order

Worst-first: correctness bugs → rule/ADR violations → accessibility → other deviations → design smells → comment nits.

## The loop — one finding, one diff, one decision

For each finding in order:

1. **Implement it.** Edit the files. Keep the change inside the finding.
2. **Verify it.** Run the narrowest useful check (one test file over `make test`; `pnpm run typecheck` alone when only types moved).
3. **Present it**, then STOP:

> **Finding N of M — `<id>`**
> - **Problem** — one or two lines. Quote the offending line.
> - **Impact** — the concrete failure or cost if left as is.
> - **Fix** — the applied diff (`git diff -- <files>`, trimmed to the hunks you changed). Every changed line shown, nothing summarised.
> - **Check** — the command you ran and its result.

4. Wait for one of:
   - **Keep** → move to the next finding.
   - **Revise** ("do it differently", or a specific instruction) → reverse your edit, implement the alternative, present again.
   - **Revert / skip** → reverse your edit, record it as skipped (with the reason if given), move on.

Rules:

- **One finding in flight.** Do not touch the next finding's files until the current one is kept or reverted.
- **Revert = reverse your own edits with Edit.** Never `git checkout`, `git restore`, or `git stash` — the tree holds other uncommitted work.
- **Stay inside the finding.** An adjacent problem uncovered by the fix becomes a new finding appended to the queue, not a widening of this diff.
- **Blocked** (needs a product decision, a credential, or a refactor bigger than a finding warrants) → do not implement. State the block in one line, name the smallest safe step, wait.

## When done

1. Run `make check` and `make test` once over the full set of kept fixes; report the result.
2. Summarise: **kept** (one line each), **skipped** (with reason), **newly surfaced**.
3. Next: `/commit`, then re-run `/validate` if a correctness fix changed behaviour.
