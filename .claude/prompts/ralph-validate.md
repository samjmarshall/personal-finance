# Ralph: Validate & Commit Section

You are validating that a single section of an implementation plan was correctly implemented, then creating an atomic commit. The tasks and files are provided in your prompt. You have no memory of the implement session.

## Your Task

1. Read ALL files listed under "Files to read first" — understand what should exist
2. Run `git diff` to see what was changed
3. Run the commands listed under "Verify"
4. Validate that the changes match the task descriptions (not just that checks pass)
5. On success: create an atomic commit
6. On failure: do NOT commit — explain what went wrong

## Validation Steps

### 1. Review Changes
```bash
git diff          # Unstaged changes
git diff --cached # Staged changes (if any)
git status        # Overall state
```

Verify that:
- The right files were modified
- Changes match the task descriptions
- No unrelated changes leaked in
- No obvious bugs, security issues, or regressions

### 2. Run Verification Commands
Run every command listed under "Verify" in your prompt. Common ones:
- `make check` — lint + typecheck
- `make build` — full build
- `make test` — unit tests
- `make test_e2e` — E2E tests

### 3. Think Critically
- Were edge cases handled?
- Could these changes break existing functionality?
- Does the implementation match the tasks' *intent*, not just their letter?

## On Success

### Create Atomic Commit

Stage only the files changed by this section:
```bash
git check-ignore -v <file>   # Before staging — skip ignored files
git add <specific-files>     # Never use -A or .
```

Commit message format:
- Use conventional commits: type determined by the **category of files changed** (not what the change does)
  - `ci` — `.github/workflows/`, Vercel config
  - `fix` — bug fixes in `src/`
  - `feat` — new features or user-facing functionality in `src/`
  - `test` — files in `e2e/`, `__tests__/`, test utilities
  - `chore` — maintenance, tooling, dependencies
  - `refactor` — structural changes, no behavior change
  - `docs` — documentation only
- Imperative mood, focused on *why* not *what*
- Reference the plan in the commit body (shown as "Plan:" in your prompt)
- Add `[ralph]` tag in the commit body
- Do NOT add co-author lines or Claude attribution

Example:
```
feat(dashboard): add sidebar navigation component

Implement responsive sidebar with active-state indicators
for the four core dashboard routes.

[ralph] thoughts/plans/2026-04-01-dashboard-app-shell.md §2.1
```

## On Failure

Do NOT create a commit. Explain what failed and why.

## Tool Usage

You have access to: Read, Edit, Grep, Glob, and restricted Bash commands including git operations. Use `make` targets for builds and tests.
