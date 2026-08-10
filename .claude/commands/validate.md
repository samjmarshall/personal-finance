---
model: opus
effort: xhigh
---
# Validate Plan

You are tasked with validating that an implementation plan was correctly executed, verifying all success criteria and identifying any deviations or issues.

## Initial Setup

When invoked:
1. **Determine context** - Are you in an existing conversation or starting fresh?
   - If existing: Review what was implemented in this session
   - If fresh: Need to discover what was done through git and codebase analysis

2. **Locate the plan**:
   - If plan path provided, use it
   - Otherwise, search recent commits for plan references or ask user

3. **Gather implementation evidence**:
   ```bash
   # Check recent commits
   git log --oneline -n 20
   git diff HEAD~N..HEAD  # Where N covers implementation commits

   # Run the full automated suite — mirror what phases list under `**Automated**`
   cd $(git rev-parse --show-toplevel) && make build && make check && make test && make test_e2e
   ```

## Validation Process

### Step 1: Context Discovery

If starting fresh or need more context:

1. **Read the implementation plan** completely
2. **Identify what should have changed**:
   - List all files that should be modified
   - Note all success criteria (automated and manual)
   - Identify key functionality to verify

3. **Spawn parallel research tasks** to discover implementation:
   ```
   Task 1 - Verify database changes:
   Research if migration [N] was added and schema changes match plan.
   Check: migration files, schema version, table structure
   Return: What was implemented vs what plan specified

   Task 2 - Verify code changes:
   Find all modified files related to [feature].
   Compare actual changes to plan specifications.
   Return: File-by-file comparison of planned vs actual

   Task 3 - Verify test coverage:
   Check if tests were added/modified as specified.
   Run test commands and capture results.
   Return: Test status and any missing coverage
   ```

### Step 2: Systematic Validation

**Reference integrity (do this once, before per-phase validation):**

The new plan template requires every code reference to include `file:line`. Validate those anchors still resolve:

- Extract every `` `path:line` `` citation from `## Current State`, each phase's `### Changes`, and `## References`
- Confirm each file exists and the cited line is still a plausible anchor for the described change (line drift of ±10 is fine; a vanished symbol is not)
- Flag any anchor that's become stale — the plan may need iterating before validation can finish

**ADR & terminology backstop (do this once):**

`/implement` resolves Proposed ADRs as it builds, but validation is the last line of defence — no ADR tied to this work may remain unresolved once validation passes.

- For every ADR cited by the plan (`## References` → `ADRs:`) or the design doc's `## Related ADRs` still in `Proposed`/`In Progress`: resolve it per `.claude/skills/domain-model/ADR-FORMAT.md`. Set `Accepted` if the shipped code reflects the decision; set `Rejected` (or `Superseded by [ADRNNN](...)`) if the code took another path. Cite the `file:line` evidence in the report.
- Confirm each `## Terminology TODO` resolution actually landed in `CONTEXT.md` and that the code uses the canonical term, not the old/fuzzy one. Flag drift.

For each phase in the plan:

1. **Check completion status**:
   - Look for checkmarks in the plan (- [x])
   - Verify the actual code matches claimed completion

2. **Run automated verification**:
   - Execute every command listed under the phase's `### Success` → `**Automated**` checklist
   - Document pass/fail status per command
   - If failures, investigate root cause
   - If an E2E spec fails, re-run just that spec once via `@agent-codebase-verification` before starting root-cause analysis. Only treat the failure as a real regression if it fails twice in a row. First-run flakes on parallel specs are a recurring pattern.

3. **Assess manual criteria**:
   - Walk every item under the phase's `### Success` → `**Manual**` checklist
   - Tick items you've personally verified; leave the rest unchecked with a note on what's still needed
   - If any phase invokes `/design-review` (required for UI phases), run it **once for the whole plan** as `/design-review <plan-path>` rather than per-phase — passing the plan path lets it decompose the branch into isolated per-surface reviews aligned with the plan's UI phases and Manual criteria, run them in parallel, and return one consolidated report. Fold each per-surface verdict into the validation report. A phase with UI changes is not validated until its surfaces are clean in that report

4. **Run code review**:
   - Always run `/code-review <plan-path>` once over the whole branch and fold its findings into the validation report's "Code Review Findings" section. The built-in runs its own multi-agent review out-of-context, so this does not flood validation. Omit `--comment` here — the PR may not exist yet, and the CI "Claude Code Review" workflow posts inline PR comments once a PR is open.
   - Run `/quality-control` over the branch diff (fixed point: the plan's base, same as `origin/HEAD` unless stated otherwise). Fold its smell findings into "Code Review Findings" as a "Design smells (judgement calls)" subsection — never merge them into hard findings.
   - Run the `/code-comment` skill's judge mode over the same branch diff (same fixed point). It spawns an isolated sub-agent that verdicts the changed comments (`PASS`/`REWRITE`/`REMOVE`/`FIX_CODE`); fold its findings into "Code Review Findings" as a "Comment quality (judgement calls)" subsection, kept separate from hard findings like the smell subsection. Apply the suggested `REWRITE`/`REMOVE`/`FIX_CODE` fixes, or note why not.
   - **Conditionally** run `/security-review` when the branch diff touches security-sensitive paths — `src/lib/**`, `src/env.js`, `next.config.ts`, `**/auth/**`, `**/*.env*` (mirrors how `/design-review` is conditional on `src/` UI changes). Fold its findings into the report. Check the diff with `git diff --name-only origin/HEAD...`.

5. **Think deeply about edge cases**:
   - Were error conditions handled?
   - Are there missing validations?
   - Could the implementation break existing functionality?

6. **Update inline docs**:
   - Update **`docs/README.md`** when the plan adds an env var, integration, scheduled job, or Make target. Skip otherwise.

### Step 3: Update Associated Issue

If the plan's `## References` links to an issue or ticket, sync your verification results back to it.

1. **Read the issue body** for existing acceptance criteria or verification checklists.
2. **If it has checkboxes**, update them to reflect your results. Only check items you verified — leave manual items unchecked.
3. **If it has no checkboxes**, skip this step.
4. GitHub: `gh issue edit <number> --body "..."`. Linear: MCP tools. File tickets: Edit tool.

### Step 4: Generate Validation Report

Create comprehensive validation summary:

```markdown
## Validation Report: [Plan Name]

### Implementation Status
✓ Phase 1: [Name] - Fully implemented
✓ Phase 2: [Name] - Fully implemented
⚠️ Phase 3: [Name] - Partially implemented (see issues)

### Automated Verification Results
✓ Build passes: `make build`
✓ Lint + typecheck: `make check`
✓ Unit tests: `make test`
✗ E2E: `make test_e2e` (1 failing spec — see below)
✓ Design review: `/design-review <plan-path>` — per-surface status (UI phases only)
  ✓ /claims/[id] workspace · ✓ clause slide-over · ⚠️ audit slide-over (see findings)
✓ Code review: `/code-review <plan-path>` — N findings folded below
✓ Comment quality: `/code-comment` judge — N verdicts folded below (PASS/REWRITE/REMOVE/FIX_CODE)
✓ Security review: `/security-review` — run (security-sensitive paths changed) · no findings

### ADR & Terminology
✓ adr013 Accepted — code at `src/...:NN` matches the decision
✗ adr014 still Proposed — no implementing code found (recommend Reject)
✓ CONTEXT.md term "Lead" persisted and used consistently in code

### Code Review Findings

#### Matches Plan:
- Database migration correctly adds [table]
- API endpoints implement specified methods
- Error handling follows plan

#### Deviations from Plan:
- Used different variable names in [file:line]
- Added extra validation in [file:line] (improvement)

#### Potential Issues:
- Missing index on foreign key could impact performance
- No rollback handling in migration

### Manual Testing Required:
1. UI functionality:
   - [ ] Verify [feature] appears correctly
   - [ ] Test error states with invalid input

2. Integration:
   - [ ] Confirm works with existing [component]
   - [ ] Check performance with large datasets

### Recommendations:
- Address linting warnings before merge
- Consider adding integration test for [scenario]
- Document new API endpoints
```

## Working with Existing Context

If you were part of the implementation:
- Review the conversation history
- Check your todo list for what was completed
- Focus validation on work done in this session
- Be honest about any shortcuts or incomplete items

## Important Guidelines

1. **Be thorough but practical** - Focus on what matters
2. **Run all automated checks** - Don't skip verification commands
3. **Document everything** - Both successes and issues
4. **Think critically** - Question if the implementation truly solves the problem
5. **Consider maintenance** - Will this be maintainable long-term?

## Validation Checklist

Always verify:
- [ ] All phases marked complete are actually done
- [ ] Automated tests pass
- [ ] `/code-review` run over the branch; findings triaged
- [ ] `/quality-control` design smell review run over the branch; judgement calls noted
- [ ] `/code-comment` judge run over the branch; comment verdicts noted and fixes applied
- [ ] `/security-review` run when security-sensitive paths changed; findings triaged
- [ ] Code follows existing patterns
- [ ] No regressions introduced
- [ ] Error handling is robust
- [ ] Documentation updated if needed
- [ ] Manual test steps are clear
- [ ] No ADR tied to this work remains `Proposed`/`In Progress`
- [ ] `## Terminology TODO` resolutions present in `CONTEXT.md` and used in code

## Relationship to Other Commands

Recommended workflow:
1. `/implement` - Execute the implementation
2. `/commit` - Create atomic commits for changes
3. `/validate` - Verify implementation correctness (runs `/code-review`, and `/security-review` when security-sensitive paths changed)
4. `/document-feature {slug}` - Run for user-visible features (new route, flow, or integration). Take `{slug}` from the ticket title. Skip for infra, refactors, bug fixes, or test-only changes.
5. `/domain-model` - Run when the plan adds or restructures a domain concept or entity boundary. Skip otherwise.
6. `/pull-request` - Generate a PR. The CI "Claude Code Review" workflow then reviews the PR automatically; for a substantial change, optionally run `/code-review ultra` as a deep pre-merge gate (paid — see CLAUDE.md).

The validation works best after commits are made, as it can analyze the git history to understand what was implemented.

Remember: Good validation catches issues before they reach production. Be constructive but thorough in identifying gaps or improvements.
