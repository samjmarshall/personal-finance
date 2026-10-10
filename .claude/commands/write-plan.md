---
skills: writing-clearly-and-concisely, tdd
model: opus
effort: xhigh
---
# Implementation Plan

Produce a complete, actionable plan at `thoughts/plans/YYYY-MM-DD-ENG-XXXX-description.md` before writing code. If invoked without a ticket/task, ask once, then wait.

## Workflow

1. **Explore.** Read the ticket and cited files first. For non-trivial scope, launch subagents in parallel — one focused question each, plus the paths you already know — routing by intent:
   - **Where code lives** → `codebase-locator`
   - **How it works** (data flow, signatures, call paths) → `codebase-analyzer`
   - **Prior art to mirror** (patterns, conventions, test setups) → `codebase-pattern-finder`
   - **Prior decisions & context** (designs, plans, research in `thoughts/`) → `thoughts-locator` to find, then `thoughts-analyzer` to distil one
   - **Decisions of record** (ADRs, feature docs in `docs/`) → `docs-locator` to find, then `docs-analyzer` to distil one
   - **Broad or cross-cutting scope** the others don't fit → `Explore`

   Demand `file:line` for every claim. Reuse existing helpers before writing new ones.
2. **Align.** Share a 2–4 bullet design sketch and get explicit agreement. Ask only what code cannot answer.
3. **Write.** Save the plan to the path above using the template below and stop. The final plan must have zero open questions — resolve them before writing.

## Design-doc handoff (ADRs & terminology)

When planning from a `/brainstorm` design doc, reconcile its appendix **before** writing phases:

- **Unresolved `## ADR Candidates` or `## Terminology TODO`** mean `/domain-model` hasn't run. **STOP and do not draft the plan** — those decisions must exist as **Proposed** ADRs (and terms persisted to `CONTEXT.md`) before planning. Tell the user to run `` `/domain-model <design-doc-path>` ``, then resume.
- **`## Related ADRs`** lists the **Proposed** ADRs this work depends on. Every Proposed ADR must map to the phase that implements it — cite it in that phase's `### Changes` (e.g. `docs/adr/adrNNN-slug.md — implements this decision`). Flag any Proposed ADR with no implementing phase. Use `docs-locator` to confirm each referenced ADR exists and its recorded `Status:`, and `docs-analyzer` to distil an existing **Accepted** ADR the plan must compose with.
- Use the canonical terms from `CONTEXT.md` throughout the plan — phase names, file paths, identifiers.

## Template

    ---
    date: YYYY-MM-DD
    design: thoughts/designs/YYYY-MM-DD-description.md
    adrs: [adrNNN, adrNNN]
    status: Ready to implement
    ---
    # <Feature> Implementation Plan

    ## Context
    Problem, trigger, intended outcome. 2–4 sentences.

    ## Current State
    What exists today; key constraints. Cite `file:line`.

    ## Desired End State
    Verifiable description of the finished system.

    ## Out of Scope
    Explicit non-goals.

    ## Approach
    High-level strategy. 2–5 sentences.

    ## Phase 1: <name>
    ### Changes
    - `path/to/file.ext` — <change>
    - `path/to/file.test.ts` — <test covering this change>

    ### Success
    - [ ] `make check` passes
    - [ ] `make test` passes
    - [ ] <observable behaviour>

    ## Phase 2: …

    ## References
    - Ticket: <path/URL>
    - Design doc: <path> (carries `## Related ADRs`)
    - ADRs: `docs/adr/adrNNN-slug.md` (Proposed) — implemented by Phase N
    - Related: `file:line`, prior plan, research doc

## Rules

- Open with YAML frontmatter: `date` (today), `design` (path, or omit if none), `adrs` (list of Proposed ADR ids, `[]` if none), `status` (`Ready to implement`). Keep it in sync with the `## References` section.
- `status` is a one-glance progress label, separate from the checkboxes. `/implement` and `/validate` move it along; only the user sets `Superseded`. M = number of `## Phase` headings:
  - `Ready to implement` — `/write-plan` saved the plan
  - `In Progress - Phase N of M` — `/implement` is building Phase N
  - `Ready for Review - Phase N of M` — `/implement` finished Phase N and its `### Success` checks
  - `Validated - Phase N of M` — `/validate` confirmed Phases 1–N
  - `Done` — `/validate` confirmed every phase, or the user calls it shipped
  - `Superseded by <plan path or ADR>` — a later plan or decision replaced this one
- Tests ship in the phase that changes behaviour, not a trailing appendix.
- Success criteria are one flat checklist — don't group them by who verifies them. Runnable criteria use `make` targets (`make check`, `make test`, `make build`, `make test_e2e`); the rest state an observable behaviour.
- UI phases add `/design-review` as a success checklist item.
- Phases touching security-sensitive paths (`src/lib/**`, `src/env.ts`, `next.config.ts`, `**/auth/**`, `**/*.env*`) add `/security-review` as a success checklist item.
- `/code-review` over the whole branch is a standing `/validate` step — do not add it as a per-phase success checklist item.
- Refactors include characterization tests before the behaviour change.
- Every reference to existing code includes `file:line`.
- Non-trivial test work follows the TDD vertical-slice loop — one test → one impl → repeat. See the `tdd` skill.
- Plans built from a design doc resolve its `## ADR Candidates` / `## Terminology TODO` via `/domain-model` first, then map each resulting Proposed ADR to an implementing phase.
