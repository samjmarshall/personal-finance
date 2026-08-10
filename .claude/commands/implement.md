---
skills: tdd, code-comment
model: sonnet
effort: high
---
# Implement Plan

You are tasked with implementing an approved technical plan from `thoughts/plans/`. These plans contain phases with specific changes and success criteria.

## Getting Started

When given a plan path:
- Read the plan completely and note any existing checkmarks (- [x])
- Read the linked ticket under `## References` for intent and acceptance criteria
- **Delegate the file-anchor sweep — don't read the cited files inline.** The `file:line` anchors in `## Current State` and each phase's `### Changes`, plus the ADRs under `## References`, are load-bearing, but reading them all in full floods the context before you write any code. Spawn a `codebase-analyzer` agent with the plan path and this prompt:

  > Build a reference digest for the plan at `<plan-path>`. Cover every anchor in `## Current State` and every phase's `### Changes` — including the Phase 3/4 delete-targets and files the plan creates, not just the early phases.
  > - `file:line` anchor → the cited lines ±10 of context plus a 1–2 line note on what matters.
  > - Path with no line number (a file to delete or create) → confirm whether it exists today and what it holds, or mark it "(to create)".
  > - Each ADR under `## References` → its Status and the Decision Outcome section only (first ~2 paragraphs).
  > - Flag any anchor that doesn't resolve, and any `## Current State` claim the live code already contradicts — the plan may be stale.

  Work from the digest. You never edit ADRs or `## Current State` files, so it is final for those. For a file you'll edit, the digest is only a map: read it in full at its phase (Edit requires a prior read anyway) — never edit from a summary, never use limit/offset on a file you're changing.
- Think deeply about how the pieces fit together
- Create a todo list mirroring the plan's phases and per-phase `### Changes` entries
- Run the Pre-flight risk scan (next section) before writing code.

If no plan path provided, ask for one.

## Pre-flight: Risks & Gotchas

Before writing code, scan the plan for these risks and state findings in a short block:

1. **Schema changes** — name each migration step. Never use schema-push shortcuts that bypass the migrations log.
2. **CI trigger scope** — for any workflow change, state the trigger. `repository_dispatch`, `schedule`, and `workflow_dispatch` run from the default branch; changes on a feature branch take no effect until merged.
3. **Env vars** — list new variables and where to set them (local + deployment).
4. **Test data** — identify external records the plan creates and confirm each spec cleans them up in `afterAll`.
5. **Proposed ADRs** — list every ADR cited by the plan (`## References` → `ADRs:`) or the design doc's `## Related ADRs` that's still `Proposed`/`In Progress`. These are the decisions this plan exists to prove out; you'll resolve their status as their phases land (see "Resolving ADRs").

Wait for approval before editing files. If the plan has zero risks, say so and proceed.

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:
- Follow the plan's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan as you complete sections

## TDD Loop

Plans list test files alongside implementation files under `### Changes` (e.g. `path/to/file.ts` + `path/to/file.test.ts`). For each such pair, follow the `tdd` skill's vertical-slice loop:

1. Write the test first — narrowest slice that exercises the behaviour
2. Run it and confirm it fails for the right reason
3. Implement the minimum to make it pass
4. Repeat for the next slice

For refactors, write characterization tests capturing current behaviour **before** changing any implementation.

When things don't match the plan exactly, think about why and communicate clearly. The plan is your guide, but your judgment matters too.

If you encounter a mismatch:
- STOP and think deeply about why the plan can't be followed
- Present the issue clearly:
  ```
  Issue in Phase [N]:
  Expected: [what the plan says]
  Found: [actual situation]
  Why this matters: [explanation]

  How should I proceed?
  ```

## Verification Approach

After implementing a phase:
- Run **every** command listed under the phase's `**Automated**` checklist (typically some combination of `make check`, `make test`, `make test_e2e`) — don't assume one covers the others
- Fix any issues before proceeding
- Walk the phase's `**Manual**` checklist; check off only what you've actually observed
- Update checkboxes in the plan file using Edit as items are verified

Don't let verification interrupt your flow - batch it at natural stopping points.

## Resolving ADRs

This plan may implement decisions captured as **Proposed** ADRs in `docs/adr/` (see `## References` → `ADRs:`, or the design doc's `## Related ADRs`). **You own the Proposed → Accepted/Rejected transition.** Resolve each ADR as its phase lands, per `.claude/skills/domain-model/ADR-FORMAT.md`:

- **Decision held** — the implementation bears it out: set Status to `Accepted` and bump `Date`.
- **Decision changed or dropped** — you took a different path: set the old ADR to `Rejected`, or write a replacement ADR and mark the old one `Superseded by [ADRNNN](adrNNN-slug.md)`. Never silently mutate an already-Accepted/Rejected decision.
- Leave an ADR `Proposed` only if its phase is genuinely incomplete — `/validate` backstops anything left unresolved.

Use canonical terms from `CONTEXT.md` in all code, identifiers, and comments.

## Comments

Write and update code comments to the `code-comment` skill's writer standard as
you code: a comment must carry *why* the code can't (intent, constraint, external
reference); never restate *what* the code does; make the code self-explain
(rename / extract) before reaching for a comment; keep what remains ELI5-terse.
`/validate` runs the same skill's judge over the branch, so comments written
off-standard get flagged there — write them tight the first time.

## UI/Frontend Phases

When a phase modifies UI components, pages, or styles in `src/`:
- Use the `frontend-design` skill to guide implementation
- Follow `.claude/skills/frontend-design/design-checklist.md`
- Run `/design-review <plan-path> <phase-number>` after completing the phase — passing the plan path and the just-completed phase number as the focus hint scopes the parallel review to that phase's surfaces/overlays/states instead of re-reviewing the whole branch each phase

## Security-Sensitive Phases

When a phase touches security-sensitive paths — `src/lib/**`, `src/env.js`, `next.config.ts`, `**/auth/**`, `**/*.env*` — run `/security-review` after completing that phase. This is the security analogue of the per-phase `/design-review`: catch injection, authn/authz, secret-exposure, and misconfiguration issues while the change is fresh, rather than waiting for `/validate` or CI. Fast `/code-review` is not run per-phase — it runs once over the whole branch in `/validate`.

## Documentation

After all phases are complete, update docs so the next engineer picks up cold:

- **`docs/README.md`** — update when the plan adds an env var, integration, scheduled job, ADR, or Make target. Skip otherwise.
- **`/document-feature {slug}`** — run for user-visible features (new route, flow, or integration). Take `{slug}` from the ticket title. Skip for infra, refactors, bug fixes, or test-only changes.
- **`/domain-model`** — run when the plan adds or restructures a domain concept or entity boundary. Skip otherwise.

If a skill is unavailable, flag it in your summary. Don't hand-write the artefact.

## If You Get Stuck

When something isn't working as expected:
- First, make sure you've read and understood all the relevant code
- Consider if the codebase has evolved since the plan was written
- Present the mismatch clearly and ask for guidance

Use sub-tasks sparingly - mainly for targeted debugging or exploring unfamiliar territory.

## Resuming Work

If the plan has existing checkmarks:
- Trust that completed work is done
- Pick up from the first unchecked item
- Verify previous work only if something seems off

Remember: You're implementing a solution, not just checking boxes. Keep the end goal in mind and maintain forward momentum.
