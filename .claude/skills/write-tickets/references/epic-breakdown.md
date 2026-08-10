# Breaking a plan into an epic with child issues

Use this workflow when the user brings a `thoughts/designs/*.md`, a `thoughts/plans/*.md`, a PRD, or an in-chat spec and wants it turned into a parent epic plus independently-grabbable child issues.

The single-ticket workflow in `SKILL.md` covers atomic issues. This sub-skill covers the breakdown.

## Vertical-slice rules

Vertical-slice rules are defined in **`SKILL.md` § Tracer-bullet vertical slices**. Every child issue follows them — refer to that section for the comparison table and the "thin slice through every layer" principle. This file covers the *publishing workflow* once you've sliced.

Per `SKILL.md` § Work-readiness, each slice carries an AFK or HITL — `<reason>` tag. A well-decomposed epic is mostly AFK with a few HITL slices gating the rest (the architectural call, the design review).

## Workflow

### 1. Gather context

- Read the source plan/design/PRD in full.
- If a parent issue already exists (the user passed an issue number/URL), `gh issue view <N>` it including comments.
- Skim the relevant area of the codebase enough to know which domain terms (`CONTEXT.md`) and ADRs (`docs/adr/`) apply. Slice titles must use the project's vocabulary.

### 2. Draft the slice list

Number each proposed slice. For each, show:

- **Title** — short, action-verb opening (`Add`, `Replace`, `Fix`, `Document`, `Lift`).
- **Type** — AFK or HITL — `<reason>`.
- **One-line summary** of the end-to-end behaviour delivered.
- **Blocked by** — which other slices (by number) must complete first. `None — can start immediately` if no blockers.

### 3. Quiz the user before publishing

Present the numbered list and ask **all four** in one round:

- Does the granularity feel right? Too coarse, too fine, mixed?
- Are the dependency relationships correct?
- Should any slices be merged or split?
- Are AFK / HITL marks correct?

Iterate until the user approves. **Do not publish anything before approval** — at this point you have not touched the issue tracker, so changes are free.

### 4. Publish in dependency order

You **author**; the `github-issue` agent **executes**. Keep the slicing, prose, and date judgment here — hand the agent a prepared set and let it run the noisy `gh` flow, so create loops, sub-issue links, and field mutations never land in your context.

Once the user approves:

1. **Write the body files.** Draft the parent epic body (template in `references/epic-template.md`) and every child body to files (e.g. `epic.md`, `c1.md … ck.md` in scratch). In the bodies, write cross-references with **number tokens, not real numbers** — `Part of #{{EPIC}}`, `Blocked by #{{S3}}`, "see #{{S5}}". The agent substitutes `{{EPIC}}` → `P` and `{{S1}}…{{Sk}}` → `P+1 … P+k` once the parent number is known, so you never need to predict numbers.
2. **Build the field plan.** For each issue, decide Status (`Todo`), Start date, and Target date — derive dates from the dependency order so blockers start first and the last child's Target date lands on or before the milestone due date (the field spec is in `references/github-publishing.md`).
3. **Delegate the publish in one call** to the `github-issue` agent (`subagent_type: github-issue`). Hand it: the ordered `{title, body-file}` list (parent first, then children in dependency order); the epic's `epic` + any `refactor`/area labels; the milestone; and the per-issue field plan. (The agent discovers the repo and the linked Project board itself — you don't pass them.) The agent creates from the body files (substituting tokens), wires each child as a sub-issue of the parent, adds every issue to the Project and sets its fields, then runs the post-publish validator (`--epic <P>`) and loops until exit 0.
4. **Relay the agent's result.** It returns distilled refs — epic `#P` + URL, children `#n` + URLs in dependency order, link/field ok-fail counts, and the validator verdict. Do not re-run `gh` yourself to "check"; the agent already grounded and reported it. If the validator failed on a **content** defect (missing section, weak AC), fix the body file and re-delegate, **handing the agent the existing issue numbers** so it edits in place (`gh issue edit`) rather than creating duplicates — that judgment is yours, the execution is the agent's.

This is **one delegation, no mid-flow prompts** — creation, linking, field assignment, and validation are all the agent's single pass.

### 5. Confirm and report

After all issues are created, report back:

- Parent epic URL and number.
- Bulleted list of child URLs in dependency order, each marked AFK / HITL.
- Any slice that needs human follow-up before an agent can grab it (HITL with reason).

## Body anatomy of a child slice

Each child must be **AFK-ready** — see `references/agent-brief.md` for the full principles. Required sections:

```markdown
**Work-readiness:** AFK    <!-- or HITL — reason -->

## Purpose
Why this slice exists, in one paragraph. References the parent epic
and the design doc.

## Current / Desired behaviour
What today does vs what this slice delivers. Behavioural — no file
paths in the spec.

## Acceptance criteria
- [ ] Binary, mechanically verifiable.
- [ ] Includes the relevant verification gate (`make check`, `make build`,
      or the spec-specific gate).

## Out of scope
- Adjacent slices in this epic (refer by number).
- Anything the design doc explicitly deferred.

## References
- Parent epic: #<P>
- Design: `thoughts/designs/YYYY-MM-DD-<name>.md`
- Representative file (starting point, may have moved):
  `src/path/to/example.ts`

Blocked by #<N>      <!-- omit if independent -->
Part of #<P>
```

## Anti-patterns to refuse

- **Layer-cake slices** ("schema PR", "API PR", "UI PR"). Reshape into vertical slices before publishing.
- **Hidden HITL** — a slice marked AFK that secretly needs an architectural call. Surface it explicitly.
- **Speculative slices for "future flexibility"**. If the design doc didn't ask for it, don't issue it.
- **One mega-issue with checkboxes for sub-tasks**. That's a planning doc, not an epic. Each checkbox should be a real child issue.
- **Publishing before user approval** of the slice list. The cost of edits before publish is zero; after publish it's a cleanup task.
