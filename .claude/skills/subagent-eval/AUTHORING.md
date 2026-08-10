# Authoring a new sub-agent

Read this only when **creating** a new agent. Produce the agent file, then go to [SKILL.md](SKILL.md) and validate it like any other change — a new agent ships *after* it wins its head-to-head, not before.

## 1. Mirror the closest canonical pair

The suite is organised as locator/analyzer pairs, one family per source-of-truth. Copy the structure and altitude of the nearest analog — don't invent a shape.

| Family | Source of truth | Locator | Analyzer | Altitude |
|---|---|---|---|---|
| `codebase-*` | code | red / **opus** (anti-fabrication) | orange / **opus** (code tracing) | ~63 / ~78 lines |
| `thoughts-*` | transient designs/plans (speculative — infer staleness) | blue / sonnet | blue / sonnet | ~59 / ~68 lines |
| `docs-*` | authoritative ADRs/feature docs (report recorded Status) | green / sonnet | green / sonnet | ~60 / ~59 lines |

Pick by *what the agent reads* and *whether that source is speculative or authoritative* — that choice drives the analyzer's core stance (infer-staleness vs report-recorded-status).

## 2. Frontmatter

```yaml
---
name: <family>-<role>
description: <what>. Use when <when>. Not for <when-not, with reciprocal redirects>.
tools: Bash, Read          # locator (search-first); analyzer is `Read, Bash`
color: <distinct from siblings>
model: sonnet              # ALWAYS start here — never assume opus; let the head-to-head decide
# effort: high            # OPTIONAL — omit to take the model's tier default; set only when the head-to-head shows a level wins
---
```

Like `model`, `effort` is a frontmatter setting the head-to-head tunes on data — but it's **frontmatter-only** (there is no per-spawn override, so the harness tests it via Path 2, not the model sweep; see [REFERENCE.md](REFERENCE.md) § Model & effort decision). Omit it unless a level proves out; `web-research.md` ships `effort: max` as the one precedent.

**The description is the routing signal** — the only thing the planner sees when choosing tools. <60 words, third person, what / when / when-not, with **reciprocal redirects** that keep the family coherent. The load-bearing boundary across the suite: docs-* = decided architecture & shipped features (authoritative) · thoughts-* = transient ideas/designs/plans (speculative) · codebase-* = code · web-* = the web. When you add an agent, tighten the siblings' when-not clauses to point at it.

## 3. Body skeleton (mirror the analog line-for-line)

- **Grounding (overrides everything below)** — the anti-hallucination block. Real tool calls only; ground every path in a tool result from THIS run; zero-matches is a valid answer; `Bash` is read-only (no writes/redirections/git). Analyzers add: read the named doc in full before stating anything; cite `path:line`; verify before asserting existence.
- **Scope** — the one-paragraph boundary. Locator = "map-maker, not analyst" (path-derived facts only). Analyzer = "curator, not reviewer" (report what the doc concluded/records, not your opinions). State facts, not judgments.
- **Responsibilities / Strategy** — how it searches or reads.
- **Output** — a concrete template; for analyzers, lead with "answer exactly what's asked — the template is optional scaffolding for open-ended asks" (guards against padding).
- **Rules** — the tight do/don't list.

Apply the `writing-clearly-and-concisely` skill to all prose. Resist bloat — the canonical agents earn their scores from a tight prompt, not length.

## 4. Then validate

A new file is **not in the session's hot registry** — to invoke it as a real `agentType` you must restart, or use the adopt-on-disk bootstrap in the harness (see [REFERENCE.md](REFERENCE.md) § Registry / bootstrap gotcha). Now return to [SKILL.md](SKILL.md) step 2 and run the head-to-head: build benchmark tasks with verified oracles (include a hard + an adversarial one), score against the baseline, decide the model on data, wire routing, verify + safety review, and record the result.
