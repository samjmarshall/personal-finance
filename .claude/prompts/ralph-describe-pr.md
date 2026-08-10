# Ralph: Describe Pull Request

You are generating a pull request description for work completed by the Ralph automated loop. The shell script that invoked you will tell you the PR number and the plan file path.

## Your Task

1. Read the PR template at `docs/pr_template.md`
2. Read the plan file completely — understand the motivation, phases, and scope
3. Run `gh pr diff {number}` to see the full diff
4. Run `gh pr view {number} --json commits` to see all commits
5. Analyze the changes thoroughly — understand what was built and why
6. Run verification commands: `make check`, `make test`
7. Generate the PR description following the template structure
8. Save to `thoughts/prs/{number}_description.md`
9. Update the PR: `gh pr edit {number} --body-file thoughts/prs/{number}_description.md`

## Description Guidelines

### Context/Motivation
- Pull from the plan's Overview section — explain the *why*
- Reference the plan file path for traceability

### Description of Changes
- Summarize each phase's changes concisely
- Organize by component/area if the plan touched multiple parts
- Call out any deviations from the plan (Ralph progress notes)

### Testing Information
- Run `make check` and `make test` and report results
- Mark checkboxes based on actual results
- Note any manual verification items from the plan that need human testing

### Relevant Links
- Link the plan file: `thoughts/plans/{plan-name}.md`
- Link the metrics file if it exists
- Add `[ralph]` tag to indicate automated generation

## Rules

### Do:
- Read the full diff — don't summarize from commit messages alone
- Be specific about what changed and why
- Mark test checkboxes based on actual command results
- Include a `[ralph]` tag in the description footer
- Mention the model and section count in the description footer

### Don't:
- Fabricate test results — run the commands
- Include the full diff in the description
- Add co-author attribution
- Skip reading the PR template
