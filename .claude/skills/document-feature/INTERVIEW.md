# Interview question bank

Three pillars. Ask **one question at a time**. After each, propose a recommended answer drawn from the codebase or related design doc, then wait for the developer to confirm or correct before moving on.

If a question can be answered by reading code or an existing `thoughts/designs/` doc, **read instead of asking**. Only put the question to the developer when the source is genuinely silent or ambiguous.

The "skip if" line tells you when the question is redundant. The "recommend from" line tells you where to look for a default answer.

---

## Pillar 1 — User value (explain-mode, ~grade 6 prose)

### 1.1 Who is the user?
- **Why it matters**: Every later answer hinges on whose work changes. Vague "the user" is a smell.
- **Skip if**: A design doc already names the persona (e.g. "Creation Homes sales consultant").
- **Recommend from**: `thoughts/designs/`, `thoughts/epics/` opening sections.

### 1.2 What problem does this solve for them?
- **Why it matters**: A feature without a problem is a feature without a reason.
- **Skip if**: An epic's "Problem" / "Business Context" section already states it.
- **Recommend from**: `thoughts/epics/*-{slug}.md` "Business Context" → "Problem" line.

### 1.3 What outcome do they need (acceptance signal)?
- **Why it matters**: This is the line you'd quote to decide whether the feature ships.
- **Skip if**: Epic has a "Success metrics" section and the developer says nothing's changed.
- **Recommend from**: Epic "Success metrics" or test names that map to user-visible behavior.

### 1.4 Who isn't this for? What's deliberately out of scope?
- **Why it matters**: Out-of-scope statements stop future engineers re-litigating the boundary.
- **Skip if**: Epic has an explicit "Out of Scope" section the dev confirms is current.
- **Recommend from**: Epic "Out of Scope" section.

### 1.5 What does the world look like without this feature?
- **Why it matters**: Anchors the value in a concrete before/after.
- **Skip if**: The dev already gave a vivid before-state in an earlier answer.
- **Recommend from**: Existing manual-process descriptions in `thoughts/research/` or pilot notes.

### 1.6 Why does the business care?
- **Why it matters**: Ties user value to commercial value — answers "why now?"
- **Skip if**: Linked epic has milestone tags (P0, M0) and the dev confirms they still apply.
- **Recommend from**: Epic "Priority" / "Milestone" frontmatter; CLAUDE.md "Current Project State".

### 1.7 Which GitHub issues and PRs does this feature trace to?
- **Why it matters**: Issues capture the original ask and discussion; PRs capture the implementation history. The feature doc must link both so a future reader can dig deeper.
- **Skip if**: The dev says explicitly "no issues/PRs" (rare — push back once).
- **Recommend from**: `gh issue list --search "{slug}"`, `gh pr list --state merged --search "{slug}"`, `git log --oneline --grep="{slug}"`. Capture the parent epic issue (if any) plus all shipping PRs. Add to frontmatter `related-issues:` and `related-prs:`.

---

## Pillar 2 — Design, architecture, ADRs & operations (tech-mode, ~grade 9-10)

### 2.1 Where does this live in code?
- **Why it matters**: A feature doc that doesn't list file paths fails its purpose.
- **Skip if**: You already located the files in recon.
- **Recommend from**: `Glob` for `src/**/{slug}*`, route segments under `src/app/`, schema files under `src/server/db/`.

### 2.2 What was the design choice, and what did you explicitly *not* do?
- **Why it matters**: Rejected alternatives are as important as the chosen path. Without them, future engineers re-propose the same options.
- **Skip if**: A linked ADR's "Considered Options" section already covers this.
- **Recommend from**: ADR "Considered Options"; design doc "Alternatives considered"; PR description rejected approaches.

### 2.3 Which existing ADRs apply?
- **Why it matters**: ADRs constrain the design; the doc must link them.
- **Skip if**: The recon phase already found them.
- **Recommend from**: Grep `docs/adr/` for keywords from the slug; check ADRs the linked design doc references.

### 2.4 Is there a hard-to-reverse decision here that has no ADR?
- **Why it matters**: Surfaces ADR gaps. **Do not create the ADR** — flag it for `/domain-model`.
- **Skip if**: The dev says no, or the choice is easily reversible.
- **Recommend from**: Database schema changes, integration patterns between contexts, technology lock-in choices, deliberate deviations from convention. See `domain-model/ADR-FORMAT.md` lines 39-47 for what qualifies.
- **Action if yes**: Add `> [!NOTE] Missing ADR: <decision>. Recommend running /domain-model.` to the doc; do not create the ADR.

### 2.5 What trade-offs should the next dev know about?
- **Why it matters**: Tribal knowledge that won't survive a handoff otherwise.
- **Skip if**: Already captured in linked ADRs or the design doc's "Trade-offs" section.
- **Recommend from**: Code comments starting with `// TODO`, `// HACK`, `// NOTE`; commit messages on the feature.

### 2.6 What logs/metrics signal this feature is healthy?
- **Why it matters**: A feature doc that doesn't tell on-call where to look is incomplete. The repo already cares about this dimension (epic-3 ops sections).
- **Skip if**: There's no observability instrumentation yet (rare — ask anyway: "should there be?").
- **Recommend from**: PostHog event names in code (`grep posthog.capture`); structured log lines (`grep "logger\." src/`); Vercel observability dashboards mentioned in `docs/README.md`.

### 2.7 What alerts fire when this breaks, and what's the fallback?
- **Why it matters**: Doubles as the on-call cheat sheet.
- **Skip if**: No alerts wired up.
- **Recommend from**: PostHog alerts, GitHub Actions failure paths, fallback patterns in code (try/catch, retry queues).

### 2.8 What feature flags or env vars gate this?
- **Why it matters**: The on-call needs to know how to disable it fast.
- **Skip if**: No flags, no env-var dependencies.
- **Recommend from**: `~/env` schema fields; PostHog flag names referenced in code; gates in `middleware.ts`.

---

## Pillar 3 — Data flow / user journey (tech-mode, with Mermaid)

### 3.1 What triggers this feature? List **all** entry points.
- **Why it matters**: Most flows have multiple triggers (UI action, cron, webhook). The happy path is rarely the only path.
- **Skip if**: There's truly only one trigger and the code confirms it.
- **Recommend from**: Route handlers, cron schedules in `vercel.json`, webhook receivers under `src/app/api/`, tRPC mutation entry points.

### 3.2 What does the user click/type/see, in order?
- **Why it matters**: The user-journey half of the flow section.
- **Skip if**: There's no human user (purely backend/cron feature).
- **Recommend from**: E2E test specs (`tests/e2e/*-{slug}.spec.ts`) — the test steps are the journey.

### 3.3 What data moves where (input → store → output)?
- **Why it matters**: The data-flow half. This is where Mermaid earns its keep.
- **Skip if**: Trivially "form → DB" with nothing in between.
- **Recommend from**: Drizzle schema files; tRPC procedure inputs/outputs; HubSpot sync patterns.

### 3.4 What state transitions happen?
- **Why it matters**: Hidden state machines bite. If there's a `status` enum that moves through values, draw it.
- **Skip if**: Feature has no stateful entity.
- **Recommend from**: Enum types in `src/server/db/schema.ts`; status fields in row types.

### 3.5 What edge cases exist, and what do we show on failure?
- **Why it matters**: A feature doc that omits edges leaves on-call guessing.
- **Skip if**: The dev names a "this can't fail" path — push back once, then move on.
- **Recommend from**: Catch blocks in code; error states in UI components (`<ErrorState>` patterns); E2E negative-path specs.

### 3.6 What downstream side effects fire?
- **Why it matters**: Webhook fan-out, queue inserts, HubSpot upserts — these are the iceberg under the visible flow.
- **Skip if**: No external integrations.
- **Recommend from**: HubSpot client calls, PostHog event captures, queue inserts, email sends via Resend.

---

## After the interview

- For every Pillar 2 ADR-gap flagged, double-check it's annotated in the draft.
- For every Pillar 3 trigger that didn't surface a Mermaid diagram, decide which type fits (`sequenceDiagram` / `flowchart LR` / `stateDiagram-v2` / `graph TD/LR`) and draw it.
- For every "skip if" you exercised, leave a short trail in the doc so a future regenerate run can pick it up.
