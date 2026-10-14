---
description: Triage then resolve the Code Review findings and Design smells from the Validation Report above, one at a time — a real applied diff for each fix, a reasoned skip for the rest, pausing for your decision on each.
argument-hint: "[--auto-skip]"
model: opus
effort: high
---

Work through **every** Code Review Finding and Design smell in the Validation Report above. One finding at a time. For each: judge again, deeply, whether fixing it is worth it. Then either write the real fix and show the diff, or recommend a skip with reasons. Stop after each.

I review code, not proposals. Never describe a fix you could have written. A skip is a reasoned verdict, not a proposal.

## Arguments

`$ARGUMENTS`

**`--auto-skip`** — don't stop on a skip. Print one line, record it, go straight to the next finding:

> **Skipped N of M — `<id>`** — <problem in a few words>. Why: <reason> (`file:line` / rule / ADR).

Only fixes and blocks stop for my decision. Without the flag, every finding stops.

## Order

Worst-first: correctness bugs → rule/ADR violations → accessibility → other deviations → design smells → comment nits.

## The loop — one finding, one decision

For each finding in order:

0. **Triage it.** Check the claim against the code first, since reviewers can be wrong. Weigh the real cost of leaving it (how likely × how bad) against the cost of the fix (churn, new indirection, a behaviour change). Decide **fix** or **skip**.
   - **Skip** → no edit. Show **Problem**, **Impact**, **Why skip**, and **Recommend: skip**, then STOP (with `--auto-skip`: one-line skip, no stop).
     - **Why skip** must cite what the call rests on: `file:line`, rule, ADR or plan line.
     - That way, a skip I overrule points at the context or doc that misled you.
     - If I say fix, run steps 1–3.
   - **Fix** → steps 1–3.
1. **Implement it.** Edit the files. Keep the change inside the finding.
2. **Verify it.** Run the narrowest useful check (one test file over `make test`; `pnpm run typecheck` alone when only types moved).
3. **Present it**, then STOP:

> **Finding N of M — `<id>`**
> - **Problem** — one or two lines. Quote the offending line.
> - **Impact** — the concrete failure or cost if left as is.
> - **Fix** — the applied diff (`git diff -- <files>`, trimmed to the hunks you changed). Every changed line shown, nothing summarised.
> - **Check** — the command you ran and its result.
> - **Recommend: keep** — one line on why it's worth it.

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
   - With `--auto-skip`, number the skips so I can say "fix 3" to reopen one. A reopened skip runs steps 1–3 like a normal fix and counts as an overruled skip for **Doc gaps**.
3. **Doc gaps**: list each skip I overruled, and the doc, rule or context that should change so the next triage gets it right.
4. Next: `/commit`, then re-run `/validate` if a correctness fix changed behaviour.
