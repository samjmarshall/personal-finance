# ADR Format

ADRs live in `docs/adr/` and use the filename `adrNNN-slug.md` with a zero-padded 3-digit number (`adr001-...`, `adr012-...`). Scan the directory for the highest existing number and increment by one.

Create `docs/adr/` lazily — only when the first ADR is needed. Two templates ship with this skill and are the source of truth:

- [ADR-TEMPLATE-SIMPLE.md](./ADR-TEMPLATE-SIMPLE.md)
- [ADR-TEMPLATE-IN-DEPTH.md](./ADR-TEMPLATE-IN-DEPTH.md)

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it — you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library — just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it — otherwise someone will suggest GraphQL again in six months.

## Choosing between simple and in-depth

Apply this rule before writing:

- **In-depth** — the session surfaced **≥2 genuine alternatives** that were weighed against each other. Use when a side-by-side comparison is the most honest representation of the decision.
- **Simple** — the decision passes the three-gate test but there was effectively one path with a constraint or two, not a side-by-side comparison. Use when "we will do X because Y" captures the substance, and a table of options would be padding.

When in doubt, ask the user. Don't pick in-depth just to look thorough — empty Pros/Cons tables are worse than a focused simple ADR.

## Frontmatter (both templates)

Every ADR begins with YAML frontmatter:

```yaml
---
Status: 'Proposed | In Progress | Accepted | Rejected | Deprecated | Superseded by [ADRNNN](adrNNN-slug.md)'
Deciders: 'Sam Marshall'
Date: 'YYYY-MM-DD'
# prettier-ignore
---
```

- **Status** — one of `Proposed`, `In Progress`, `Accepted`, `Rejected`, `Deprecated`, or `Superseded by [ADRNNN](adrNNN-slug.md)`. Use `In Progress` when the decision is leaning toward an option but is pending validation (e.g. an API spike still needs to confirm a capability).
- **Deciders** — comma-separated names. Default to the project's primary decider; include collaborators when present.
- **Date** — `YYYY-MM-DD` when the decision was last updated. Use today's date on creation; update when revisiting.
- **`# prettier-ignore`** — keep this line; it prevents prettier from reformatting the frontmatter.

## Writing each section well

- **Title** — name the decision AND the chosen solution in one line. `Use iMessage via Device-Bridge Service for Automated Sales Messaging` beats `iMessage integration`.
- **Technical Story** — optional one-liner under the title, linking to the ticket/issue/epic that prompted the decision. Omit when there isn't one.
- **Context (simple) / Context and Problem Statement (in-depth)** — describe the forces, not the solution. Value-neutral. End with a precise question the ADR answers.
- **Decision Drivers (in-depth)** — bold the driver name, then the explanation. Drivers are the criteria you'd use to score any option; an option wins by satisfying drivers, not by being the assistant's preferred vendor.
- **Considered Options (in-depth)** — one short label per option, with the key parameter that distinguishes it (cost, scope, mechanism). The numbered list is referenced by index in Decision Outcome and Pros and Cons.
- **Decision (simple) / Decision Outcome (in-depth)** — active voice. Simple: full paragraph starting with "We will ...". In-depth: single sentence — chosen option + the binding reason. If still validating, write `Leaning towards: "Option N"` and explain what blocks acceptance.
- **Consequences (simple)** — list ALL of them — positive, negative, and neutral. Every consequence affects the team and project in the future.
- **Positive / Negative Consequences (in-depth)** — split deliberately. Keep them concrete; "leads recognise the sender" beats "improves trust."
- **Pros and Cons of the Options (in-depth)** — table form is preferred when each option has roughly the same number of trade-offs; bullets ("Good, because ..." / "Bad, because ...") are fine for short asymmetric lists. Use a multi-attribute table when the options trade off across the same axes (cost, latency, reliability, etc.).
- **Open Questions (in-depth, optional)** — only when Status is `Proposed` or `In Progress`. Each item is something a concrete check or spike could resolve.
- **Links (optional)** — prefix with the relationship: `Design:`, `Epic:`, `Refined by`, `Superseded by`, `Vendor docs:`. Bare URLs are noise.

## Diagrams

- **Format follows content, per option.** A genuinely topological option (vendor/service topology) gets **D2 compiled to a committed SVG**; a flow-shaped option (sequence/state/ER/request-path) or a trivial 2–3-box architecture gets an **inline Mermaid** fenced ```` ```mermaid ```` block; a degenerate option (status-quo / one-line prose delta) gets **no diagram**.
- **Placement.** A per-option diagram sits under that option's `### N.` heading in Pros and Cons of the Options, above its table. The chosen option's diagram doubles as the Decision Outcome visual — Decision Outcome cross-references it ("see the diagram under option N") rather than duplicating it.
- **D2 source and reference.** Sources live at `docs/adr/diagrams/adrNNN-optionN-<slug>.d2` with a committed sibling `.svg`; reference the SVG from the ADR with a relative-path image: `![...](diagrams/adrNNN-optionN-<slug>.svg)`.
- **Local icons only.** Vendor icons live under `docs/adr/diagrams/icons/` and are referenced as `icon: ./icons/<name>.svg` — never hot-link `icons.terrastruct.com`. D2 embeds local icons as base64 so the SVG renders on GitHub.
- **Animate live data flow (D2 only).** Mark the primary runtime data-flow edges — ingress writes and egress fan-out — with `style: { animated: true; stroke: green }` so the diagram shows data moving; leave structural, control-plane, and durable-backstop edges static and uncoloured. Animate the primary path only — a diagram where every edge wiggles is noise, not signal. `animated` is connections-only, never shapes. See `docs/adr/diagrams/README.md`, House style.
- **Pipeline.** Run `make diagrams` after editing any `.d2` (commit both files); `make diagrams-check` is the CI freshness gate. See `docs/adr/diagrams/README.md`.

## Anti-patterns

- **Dense single-paragraph decision body.** If the Decision section is one 8-sentence paragraph, you're hiding the structure the template is designed to expose. Break it into Context / Decision / Consequences (simple) or the seven-section in-depth flow.
- **`**Status:**` as a bold inline label.** Status belongs in the YAML frontmatter, not in the body.
- **Empty option tables.** If there were no real alternatives, use the simple template. A Pros/Cons table with one option in it is theatre. Forcing a diagram onto a degenerate option is the same theatre — a one-line prose delta is better.
- **"For more context, see X"** in place of the Context section. The ADR should stand alone; link out for supporting detail, not for the decision itself.
- **Mutating an accepted ADR.** When the decision changes, write a new ADR, set the old one's Status to `Superseded by [ADRNNN](...)`, and link the new one back via the Links section.
