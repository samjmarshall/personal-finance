# Plain-language rules for feature docs

Two reading zones, Strunk on top, compression on the bottom, and a replaceable-pattern checklist you can self-verify against.

The rules below are **output rules for the doc** — Apply them as you draft, then call the writing-clearly-and-concisely skill at the end for a final pass.

---

## 1. Two reading-level zones

A feature doc has two audiences in one file. Tune the prose accordingly.

| Zone | Sections | Target | Why |
|------|----------|--------|-----|
| **explain-mode** | One-sentence summary, "User value" pillar | ~grade 6 | Anyone (PM, founder, salesperson) should grok these without a CS background. |
| **tech-mode** | "Design", "Operations", "Flow" pillars; Mermaid diagrams | ~grade 9-10 | Reader is a working developer. Technical terms (`tRPC`, `Drizzle`, `webhook`) are clearer than paraphrases. |

**Decision rule**: if a non-developer reading it would need to ask "what does that mean?", you're in the wrong zone. Drop a tech term in explain-mode → rewrite. Paraphrase a load-bearing tech term in tech-mode → restore it.

---

## 2. Strunk rules to apply

Cited from `writing-clearly-and-concisely/SKILL.md`. The four below are the load-bearing ones for feature docs. Examples use repo-flavored prose.

### Rule 10 — Use active voice
- ❌ "The lead is enriched by the HubSpot sync job."
- ✅ "The HubSpot sync job enriches the lead."

- ❌ "Errors are surfaced via PostHog."
- ✅ "PostHog captures errors."

### Rule 11 — Put statements in positive form
- ❌ "The cron does not run on weekends."
- ✅ "The cron runs Monday through Friday."

- ❌ "We did not implement bulk send."
- ✅ "Bulk send is out of scope."

### Rule 12 — Use definite, specific, concrete language
- ❌ "The system processes the message appropriately."
- ✅ "The HITL queue tags the message `pending` and surfaces it on `/queue`."

- ❌ "Alerts fire when something goes wrong."
- ✅ "PostHog alerts fire when `nurture_send_failed` exceeds 3/min."

### Rule 13 — Omit needless words
- ❌ "In order to allow users to be able to view their conversation history…"
- ✅ "To let users view their conversation history…"

- ❌ "At this point in time, the feature is gated behind a flag."
- ✅ "The feature is flag-gated."

**Application order while editing**: passive→active, negative→positive, vague→specific, then cut. Do not stop at "good enough."

---

## 3. Compression rules

These apply to *the doc*, not the conversation. Use them after the Strunk pass for a second sweep.

- **Drop articles** where it does not reduce clarity. "Cron runs nightly" beats "The cron runs nightly" in a bullet list. Keep articles in prose paragraphs where dropping reads as broken.
- **Drop filler**: *just*, *really*, *basically*, *actually*, *simply*, *very*. Cut on sight.
- **Fragments are fine** in lists, table cells, and step descriptions. Full sentences for prose paragraphs.
- **Arrows for causality**: `webhook → queue → drafted → approved → sent`. Use ASCII `->` or Unicode `→`; pick one and stay consistent within a doc.
- **Common abbreviations** (used liberally in tech-mode, sparingly in explain-mode): `DB`, `auth`, `config`, `req`, `res`, `fn`, `impl`, `env`, `PR`, `CI`. Spell out anything project-specific on first use.
- **One word when one word is enough**: "fix" beats "implement a solution for"; "use" beats "utilize"; "now" beats "at this point in time".

**Keep exact**: technical terms (tRPC, Drizzle, HubSpot, PostHog, Neon), code blocks, error messages, file paths, env-var names. These are precise on purpose.

---

## 4. Replaceable-pattern checklist

Run this list against every section before declaring the draft done. Each is a concrete swap the agent can self-verify.

| Replace | With | Why |
|---------|------|-----|
| utilize | use | shorter, plainer (Rule 13) |
| in order to | to | filler (Rule 13) |
| is able to / is capable of | can | filler (Rule 13) |
| allows X to | lets X | shorter (Rule 13) |
| at this point in time | now | one word (Rule 13) |
| in the event that | if | filler (Rule 13) |
| due to the fact that | because | filler (Rule 13) |
| was {verb}-ed by Y | Y {verb}-s | passive → active (Rule 10) |
| is not X | is non-X / is the opposite | positive form (Rule 11) |
| does not have | lacks | positive form (Rule 11) |
| handled appropriately / processed | name the actual action | concrete (Rule 12) |
| the system / the feature | name the actual module | concrete (Rule 12) |
| a number of | three / many — pick one | concrete (Rule 12) |
| various | enumerate the cases or drop the word | concrete (Rule 12) |

If you find yourself reaching for any of the left-column phrases, swap it.

---

## 5. Self-check before handoff

- [ ] Read the User-value section aloud. Would a non-developer follow it?
- [ ] Read the Flow section aloud. Does the active voice dominate? Are the actors named?
- [ ] Search the doc for *very*, *just*, *really*, *basically*, *simply* — delete every match.
- [ ] Search for "is able to", "in order to", "at this point in time" — replace.
- [ ] Confirm the Mermaid diagram uses one of the proven types (`sequenceDiagram` / `flowchart LR` / `stateDiagram-v2` / `graph TD/LR`).
- [ ] Final pass: invoke `writing-clearly-and-concisely` skill on the full doc.
