---
description: Interactive design refinement using Socratic method. Use when creating or developing, before writing code or implementation plans - refines rough ideas into fully-formed designs through collaborative questioning, alternative exploration, and incremental validation. Don't use during clear 'mechanical' processes
skills: writing-clearly-and-concisely
model: opus
effort: max
---
# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

Interview me relentlessly about every aspect of this design until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

## The Process

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
   - **@agent-codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **@agent-codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **@agent-codebase-pattern-finder** - To find similar features we can model after
   - **@agent-thoughts-locator** - To find prior designs, plans, research, or decisions about this area
   - **@agent-thoughts-analyzer** - To distil the decisions and constraints from the most relevant documents
   - **@agent-docs-locator** - To find authoritative decisions of record (ADRs, feature docs in `docs/`) governing this area
   - **@agent-docs-analyzer** - To distil an ADR's decision + recorded Status, or a feature doc's shipped behaviour
- **Read the project glossary if present.** Check for `CONTEXT.md` (or `CONTEXT-MAP.md`) at the repo root or in the relevant subdirectory. During the session, challenge terminology that conflicts with the glossary and propose canonical terms when the user uses fuzzy or overloaded ones. **Do not write to `CONTEXT.md`** — that's `/domain-model`'s job. Brainstorm output stays transient; the glossary stays durable.
- **ALWAYS use @agent-web-lookup or @agent-web-research** for web research - NEVER call WebSearch or WebFetch directly. Use `web-lookup` for single-fact queries (fast); use `web-research` for multi-source synthesis or conflict resolution (deep).
- **If a question can be answered by exploring the codebase, explore instead of asking.**

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**
- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense
- **DO NOT write to file yet** - only output text in your response

## After Validation

**Documentation (REQUIRED - do not skip this step):**
- Once the user has validated the design sections, write the complete design to `thoughts/designs/YYYY-MM-DD-<topic>.md`
- Use writing-clearly-and-concisely skill if available
- **You must always write to file** - never just present the design in chat without saving it

**ADR candidates (before STOP):**
- Scan the session for decisions that pass the 3-gate test (see `.claude/skills/domain-model/ADR-FORMAT.md`).
- If any pass, append an `## ADR Candidates` section to the design doc. Lead with one line pointing at the persist command: ``Run `/domain-model <this-design-doc-path>` to capture these as Proposed ADRs.`` Then list each candidate with a one-line decision summary and a one-line why-it-passes.
- If none pass, skip this section entirely.

**Closing handoff (before STOP):**
- If terminology was sharpened against `CONTEXT.md` during the session, append a `## Terminology TODO` section to the design doc. Lead with one line pointing at the persist command: ``Run `/domain-model <this-design-doc-path>` to persist these to `CONTEXT.md`.`` Then list each sharpened term with a one-line note on the resolution.
- If no terms were sharpened, skip this section entirely.

**STOP after the documentation and (optional) harvest steps. Do NOT:**
- Write any code or implementation
- Create any files in `src/`
- Edit any existing source files
- Proceed to implementation planning

The user will use either `/write-tickets` separately to create tickets for more complex designs or `/write-plan` to immediately create an implementation plan for simple designs.

## Key Principles

- **Relentless interviewing** - Walk every branch of the decision tree until shared understanding is reached; resolve dependencies between decisions one-by-one
- **One question at a time** - Don't overwhelm with multiple questions
- **Recommend an answer** - For each question, provide your recommended answer with reasoning
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense