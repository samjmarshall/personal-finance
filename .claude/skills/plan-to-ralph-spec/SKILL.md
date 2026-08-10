---
name: plan-to-ralph-spec
description: Convert a markdown implementation plan to a JSON spec file for ralph.sh execution
---

# Plan to Spec

Convert a markdown implementation plan into a structured `.spec.json` file that ralph.sh uses for execution.

## Invocation

The user provides a path to a markdown plan:
```
/plan-to-ralph-spec thoughts/plans/2026-04-01-code-review-best-practices-checklist.md
```

## Steps

1. Read the markdown plan file completely
2. Identify all **leaf-level sections** that contain checkbox task items (`- [ ]` lines)
3. For each section, extract:
   - **id**: A normalized, stable, unique identifier derived from the heading structure (e.g., `"1.1"`, `"p2.cat1"`, `"task-1"`). Use numeric IDs when headings have numbers; use slugified IDs when they don't.
   - **title**: The human-readable section title (heading text without the `#` prefix or numbering)
   - **tasks**: Array of task strings from checkbox items (`- [ ]` lines), stripped of the `- [ ]` prefix
   - **files**: Array of file paths mentioned in the section body (backtick-quoted paths matching `src/`, `e2e/`, `scripts/`, `.claude/`, `.github/`, `thoughts/`, `docs/`, or common extensions)
   - **verify**: Array of make/shell commands from the section's success criteria. Default to `["make check"]` if none specified
4. Skip sections with zero checkbox items — log a warning for each
5. Phases or groups (e.g., "Phase 1", "Phase 2") become ID prefixes on their child sections, not sections themselves. Only leaf-level items with tasks become sections.
6. Set all `state` fields to `"pending"`
7. Write to the same directory as the plan, replacing `.md` with `.spec.json`
8. Print a summary: section count, any warnings

## Output Schema

```json
{
  "version": 1,
  "plan": "<relative path to source markdown plan>",
  "title": "<plan title from first H1>",
  "sections": [
    {
      "id": "1.1",
      "title": "Section Title",
      "tasks": ["Task description 1", "Task description 2"],
      "files": ["src/app/page.tsx", "src/lib/utils.ts"],
      "verify": ["make check"],
      "state": "pending"
    }
  ]
}
```

## Rules

- Do NOT modify the original markdown plan
- Heading format does not matter — handle `####`, `###`, `##`, `#####`, numbered (`1.1`), named (`Category 1:`), etc.
- The spec file must be valid JSON (use `jq .` to verify before writing)
- If a section's success criteria mention specific commands (`make test`, `make build`, `make test_e2e`), include those in `verify` instead of the default
- File paths in `files` should be relative to the repo root
- IDs must be unique across all sections in the spec
