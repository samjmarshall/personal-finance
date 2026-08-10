# Publishing tickets to GitHub Issues

System-specific guidance for the GitHub Issues + GitHub Projects backend. **You do not run these `gh` commands yourself** — publishing is delegated to the `github-issue` agent (`subagent_type: github-issue`), which keeps the verbose create/link/field output out of your context and returns distilled refs + the validator verdict. This file is the **spec that agent implements**: the field shapes, the sub-issue mechanics, and the validation gate. Author the bodies + field plan (per `SKILL.md` and `epic-breakdown.md`), then hand them off.

## Linking and field assignment are part of "create"

Creation, sub-issue wiring, project membership, and field-setting are one handoff to the `github-issue` agent — not separate turns, and never a mid-flow prompt. Hand it labels/assignees/milestone (it passes them as `gh issue create` flags) and the per-issue field plan (it runs `gh project item-add` plus one GraphQL mutation per field). Sub-issue wiring applies only to epic publishing — see **[epic-breakdown.md](epic-breakdown.md)**. The mechanics below are the agent's contract, documented here so the spec has one home.

## GitHub Projects integration (the repo's linked Projects v2 board)

The agent discovers the board — it does not hard-code a project number. It resolves the repo from the local git context and the project from the repo's single linked Projects v2 board (the one open linked board; `TICKET_PROJECT` overrides). When an issue is added, set the fields the caller's field plan names. The validator enforces only these three:

| Field | Required? | Values |
|-------|-----------|--------|
| **Status** | yes | the board's status single-select (e.g. Todo \| In progress \| Done) |
| **Start date** | **required** | YYYY-MM-DD |
| **Target date** | **required** | YYYY-MM-DD |
| **Milestone** | when one applies | e.g. "M1.5 — Production assessor build" |

Set any other board fields named in the caller's field plan (a Priority, Size, Team, Iteration, etc. — whatever this board carries); leave fields the plan does not mention unset. Read each field's id/options fresh (`gh project field-list`) — board schemas differ per repo, so never assume which optional fields exist.

**Start date and Target date are mandatory and drive the date-driven roadmap** — an item missing either does not render on the timeline. Derive them from the dependency graph and the milestone due date, in working days:

- Order each issue after its `Blocked by` predecessors (topological order).
- Walk forward from the earliest start, allotting each issue its estimated working days (skip weekends).
- The last issue's Target date must land on or before the milestone's due date. If it can't, the slice plan is too big for the milestone — re-scope; don't fudge the dates.

**How the agent sets fields:** `gh project item-add` to attach the issue, then `gh project item-list <PROJECT> --owner <OWNER> --format json` to capture the item id, then one `gh api graphql updateProjectV2ItemFieldValue` mutation per field — where `<PROJECT>`/`<OWNER>` are the discovered board number and owner. It reads field/option ids fresh (`gh project field-list <PROJECT> --owner <OWNER>`) — never hard-codes them. Date fields take a `date` value; single-selects (Status, Team) take a `singleSelectOptionId`:

```bash
# date field (Start date / Target date)
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$d:Date!){
  updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{date:$d}}){projectV2Item{id}}}' \
  -f p=<PROJECT_ID> -f i=<ITEM_ID> -f f=<DATE_FIELD_ID> -f d=2026-06-30

# single-select field (Status / Team)
# … value:{ singleSelectOptionId:"<OPTION_ID>" } instead of value:{ date:… }
```

Set Status, Start date, Target date, and Milestone (when one applies) at creation. Start date and Target date are required.

The **post-publish validation gate** (see `SKILL.md`) is the agent's final step — it runs `yarn tsx .claude/skills/write-tickets/scripts/validate-ticket.ts --epic <P>` (or `<issue>` for a single ticket), loops until exit 0, and returns the PASS/FAIL verdict. Running this validator is the agent's one sanctioned exception to its `gh`-only writes; you gate on the verdict it reports. A content failure (missing section, weak AC) comes back to you to fix in the body file and re-delegate.

## Related tickets

At the bottom of the issue body, link related tickets:
- **For all tickets:** Link the parent ticket if one exists (`Part of #N`).
- **For epics:** Link all child tickets (the sub-issue API does most of this automatically — see `epic-breakdown.md`).
