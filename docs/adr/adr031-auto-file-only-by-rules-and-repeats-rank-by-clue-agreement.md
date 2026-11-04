---
Status: 'Proposed'
Deciders: 'Sam Marshall'
Date: '2026-11-04'
# prettier-ignore
---

# Auto-file only by Member Rules and exact repeats; rank every other Suggestion by Clue agreement, with the AI as a tie-breaker only

Technical Story: [2026-11-04 category groups, bank categories and filing suggestions design](../../thoughts/designs/2026-11-04-category-groups-bank-categories-filing-suggestions.md)

## Context and Problem Statement

Most Transactions are Unfiled. The history import pulls up to 7 years from 9 accounts, so
thousands of rows wait. Filing them by hand is the main friction in the app.

Several clues exist for each row:

- the **Bank category** ([adr030](adr030-copy-bank-category-list-once-keep-bank-category-as-a-clue.md)),
  right about 80% of the time;
- **past matches**, scored by word and meaning ([adr029](adr029-pair-bank-rows-by-word-and-meaning-scores.md));
- **Expense names**;
- the **Old group**;
- an **LLM**.

Published research and vendor practice agree on two points:

- An LLM's own confidence runs high and is a poor gate.
- Finance apps that automate well lean on user rules, prompting "create a rule?" when the
  user edits a row.

A wrong filing is worse than none: it hides Spend under the wrong Category, and soon (#111)
may drop it from Spend entirely. AI spend alerts at $1 a day. Data must stay in Australia
([adr014](adr014-bedrock-via-vercel-oidc.md)).

Which filings may happen without the Member, and how should the rest be ranked?

## Decision Drivers

- **Trust.** A wrong auto-filing costs more than an Unfiled row.
- **Friction falls over time.** Each answer should save future answers.
- **Bounded cost.** AI spend stays under the daily alert, even during a catch-up.
- **Measurable.** Every Strength level can be checked against labelled answers.
- **Residency.** Transaction text goes only to models hosted in Australia.

## Considered Options

1. **Rules and repeats auto-file; Clue agreement ranks the rest; the AI breaks ties.**
2. **AI on every row, auto-filing above the model's stated confidence.**
3. **A weighted score over every Clue, with the AI on every row; auto-file Strong now.**
4. **No AI.** Bank category and past matches only.

## Decision Outcome

Chosen option: "1. Rules and repeats auto-file; Clue agreement ranks the rest; the AI breaks
ties", because it auto-files only on evidence the Member created, and it keeps AI spend
bounded.

Specifics that bind:

- **Unfiled only.** The engine reads and writes only Unfiled Transactions, and it re-checks
  inside the write. A Member's filing always wins.
- **Order:**
  1. **Rule.** The most specific matching Rule wins; a tie goes to the newest.
  2. **Exact repeat.** At least 3 past rows have the same cleaned text, filed by a Member or a
     Rule, all filed the same way, none differing. They also share the same amount every
     time, or the text holds a rare word. A repeat never auto-files to a one-time Expense: a
     finished budget must not keep absorbing rows. That row becomes a Suggestion; a Rule may
     still target one.
  3. **Clues.**
- **Clues:**
  - **Bank category** through the map. "Everything Else" or unmapped gives none.
  - **Past matches.** The 10 closest filed rows at a merged score ≥ 0.59 vote by score; the
    winner needs ≥ 60%.
  - **Expense name.** Word score ≥ 0.55.
  - **Old group**, when mapped.
  - **The AI.**
- **Strength:**
  - **Strong**: 2+ Clues agree and none disagree.
  - **Weak**: 1 Clue.
  - **Split**: Clues disagree.
  - **None**: no Clue.

  No model is asked for, or trusted with, its own confidence.
- **The AI breaks ties only.** It runs on Weak, Split and None rows dated within 12 months,
  under `FILING_AI_DAILY_CALLS` (default 250). Its pick counts as one more Clue. Rows over
  the cap keep their free Clues and wait for the daily backlog run.
- **Inflow rows take an Expense only from evidence:** a Rule, past matches or an Expense
  name. The AI sees Expenses for Spend rows only, so a refund can net into Consumed while
  salary never lands on an Expense.
- **Model:**
  - Haiku through a Bedrock `au.` inference profile, set by `BEDROCK_SUGGEST_MODEL`.
  - Default `au.anthropic.claude-haiku-5-5`; fallback `au.anthropic.claude-haiku-4-5-20251001-v1:0`,
    pending a spike on structured output and Sydney prices.
  - The span processor prices each model on its own.
  - Jev is out: it isn't on Bedrock and has no Australian region.
  - Sonnet is out: it costs about 10× more per row.
- **Save as rule** sits beside every answer. Saving one offers to file matching Unfiled
  rows.
- **Auto-filed rows show their reason and an undo.** Undo marks the row so nothing
  auto-files it again.
- **Every answer is stored** (`filing_answer`), copied to PostHog, and promoted into a golden
  set that a Vitest eval scores per Clue.
- **Kill switch.** `FILING_AUTO_ENABLED=false` stops auto-filing; Suggestions still show.
- **Trigger to revisit.** If the eval shows Strong precision ≥ 98% on the golden set, a new
  ADR may let Strong auto-file and supersede this rule.

### Positive Consequences

- **The Member stays in charge.** Automation starts from what they did twice or more, or
  said once as a Rule.
- **Friction falls with use.** Each Rule saved removes a row type from review for good.
- **Cost is capped and drops over time,** since Rules and repeats need no AI.
- **Each Clue is measurable,** so the weak one shows up in the eval.
- **Transaction text stays in Australia.**

### Negative Consequences

- **More clicks at first.** Strong rows still need a tick, or a bulk accept, until the eval
  lets them auto-file.
- **Rules go stale** when a merchant changes its bank text. Rows then fall back to
  Suggestions.
- **A repeated mistake can lock in.** Three rows filed the same wrong way start
  auto-filing; undo and a fresh filing break it.
- **Some rows wait a day** for the AI when the daily cap is hit.
- **More moving parts:** a new filing domain, 5 tables, 3 Inngest functions and 2 screens.

## Pros and Cons of the Options

### 1. Rules and repeats auto-file; Clue agreement; AI tie-break

- Good, because auto-filing rests on the Member's own evidence.
- Good, because the AI runs only where the free Clues fall short.
- Good, because agreement is easy to explain: "Bank ✓, 6 past ✓".
- Bad, because Strong rows still need the Member until the eval proves them.

### 2. AI on every row, auto-file on stated confidence

- Good, because the most rows get filed with no clicks.
- Bad, because stated confidence runs high, so wrong filings slip through silently.
- Bad, because cost grows with every row, and a catch-up of thousands breaks the alert.

### 3. Weighted score over every Clue, auto-file Strong now

- Good, because one number ranks every row.
- Bad, because the weights need labels we don't have yet.
- Bad, because auto-filing Strong now has no proof behind it.
- Bad, because the AI still runs on every row.

### 4. No AI

- Good, because it costs nothing and has no model risk.
- Bad, because Split rows, and rows with no history, get no tie-break, so they stay
  hard to file.

## Links

- Design: [2026-11-04 category groups, bank categories and filing suggestions](../../thoughts/designs/2026-11-04-category-groups-bank-categories-filing-suggestions.md)
- Builds on [adr029](adr029-pair-bank-rows-by-word-and-meaning-scores.md) (word and meaning scores) and the [description-score feedback loop design](../../thoughts/designs/2026-11-03-description-score-feedback-loop.md) (answers, dataset, eval)
- Applies [adr014](adr014-bedrock-via-vercel-oidc.md), [adr015](adr015-posthog-over-opentelemetry-via-vercel-otel.md), [adr022](adr022-cross-domain-data-through-the-owning-service.md)
- Related [adr030](adr030-copy-bank-category-list-once-keep-bank-category-as-a-clue.md)
