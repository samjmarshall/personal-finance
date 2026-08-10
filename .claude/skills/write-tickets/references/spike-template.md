# Spike/Research Template

> Body principles (durability, behaviour-not-files, AC, out-of-scope) are in **[agent-brief.md](agent-brief.md)** — every ticket body must satisfy them. This template gives the type-specific structure on top.

Use this template for exploratory work, technical investigation, proof-of-concept, and research tasks.

## Template Structure

```markdown
Title: [Investigate/Research/Explore/Evaluate] [topic] [purpose]
Example: Research authentication approaches for third-party API integration

## Research Question
[What are we trying to learn or decide?]

## Context
[Why do we need this research?]

## Goals/Questions to Answer
- [ ] What authentication methods does Stripe support?
- [ ] What are security implications of each approach?
- [ ] What's the implementation complexity (time estimate)?
- [ ] What's the ongoing maintenance burden?
- [ ] What are best practices in industry?

## Deliverable
[What's the output of this spike? — usually a written recommendation, comparison table, or POC code]

## Time Box
[Maximum time to spend — spikes must be time-limited]

Example: 4 hours maximum.

## Acceptance Criteria
See `agent-brief.md` § Acceptance criteria for the full rules.

- [ ] All research questions answered.
- [ ] Recommendation document written and linked from this issue.
- [ ] Follow-up implementation tickets created.
- [ ] Decision documented in the relevant ADR if architectural.

## Resources
- Stripe authentication docs: [link]
- Similar integrations: [references]

## Follow-up Actions
[What happens after the spike?]
- Create implementation tickets based on recommendation.
- Schedule review with team.
- Get security approval if needed.
```

## Guidelines

**Title verbs (this type):** Investigate, Research, Explore, Evaluate, Spike.
Example: "Research authentication approaches for third-party API integration".

**Project-specific notes:**
- Always include a time box. Typical spikes 2–8 hours; larger research up to 1–3 days.
- After the spike: create follow-up tickets and document the decision in an ADR if architectural.
