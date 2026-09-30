# Sub-agent eval — reference

Detail behind the [SKILL.md](SKILL.md) workflow. Authoritative source for the rubrics is the design doc `thoughts/designs/2026-04-21-sub-agent-eval-pipeline.md` (§6.2/§6.3/§6.4) — this file distils the parts you need to run a head-to-head, plus the lessons from three runs.

## §6.3 execution rubric (what the judge scores)

Binary per criterion unless noted. Score the full trajectory: tool calls, output, grounding.

| Criterion | Weight | Meaning |
|---|---|---|
| Task-completion | +2 | Did it satisfy the task per the oracle? |
| Real-tool-invocation | +2 | `tool_uses ≥ 1` — real calls, not text-shaped fakes. In a `Workflow` you can't read the transcript count mid-run, so judge a **proxy**: do cited paths actually resolve on disk? |
| Factual-grounding | +2 | Claims carry verifiable refs (`path:line`, ADR #, Status) the judge confirmed against the tree. |
| Tool-scoping | +1 | Stayed within role; no wasted scope (locator = locations only; analyzer = decision/insight only). |
| Stop-discipline | +1 | Stopped without over-iterating. |
| Output-contract | +1 | Matches the prescribed output format. |
| Hallucinated paths/URLs | −1.5 | Cited anything not on disk. Verify each. |
| Unsolicited suggestions | −1.5 | Appended unrequested critique/recommendations (incl. self-inferred staleness an analyzer should have *read* from a recorded Status). |
| Refused valid task | −1.5 | Illegitimately refused. |
| Length-budget exceeded | −0.5 | Bloated past need. |

## §6.4 aggregation (clipped 0–1)

```
score = max(0, min(1, Σ(verdictᵢ · weightᵢ) / Σ{positive weights}))
```

Positive-weight denominator = **9** (2+2+2+1+1+1), so a clean run scores exactly 1.0; penalties pull down but never below 0. Compute this in JS from the judge's booleans — don't ask the model to do the arithmetic.

## §6.2 routing rubric (descriptions only)

Score the agent `description` field, not execution: Correct-invoke on positives (+2), Non-invoke on negatives (+2), Scope-clarity what/when/when-not (0/0.5/1.0), Verbosity penalty if >60 words without routing value (−0.5). Run this as a separate pass when you change descriptions.

**Bundled harness: `routing-harness-template.js`.** Unlike `harness-template.js` (which runs §6.3 *execution* candidates), the routing harness runs **no candidate** — blinded Opus judges read the on-disk `description`s, route a set of labelled probes among them (correct-invoke / non-invoke, including reciprocal-redirect traps that stress the docs⇄thoughts⇄code when-not boundaries), and rate scope-clarity + verbosity. Aggregation mirrors §6.4: `score = clip(0, 1, (2·correct-invoke + 2·non-invoke + 1·scope-clarity − 0.5·verbosity) / 5)` (positive-weight denominator = **5**; correct-/non-invoke are rates ∈ [0,1] over the probes). Fill the `POOL` + `PROBES` — verify every `expected` routing against the tree first — and launch. Run it whenever you change a `description` or add an agent.

## Scoring a new agent's contract (per-agent discriminators)

The §6.3 core rubric scores any agent, but a non-locate/analyze agent has contract rules the core can't see. Per design §6.6, extend the judge with **binary discriminator booleans** for that agent's specific contract — add them to `JUDGE_SCHEMA.properties` + `required`, and fold them into `agg()` as extra penalties (or credit). They never raise the positive-weight denominator (still 9), so a clean run still tops out at 1.0; they only let a contract violation pull the score down.

Read the agent's `.claude/agents/<name>.md` (Grounding / Scope / Output / Rules) and turn each non-negotiable into one boolean. Worked example — `codebase-pattern-finder` (a pattern *librarian*: shows examples, never judges), validated 2026-06-03:

| Discriminator | Weight | Maps to the contract's… |
|---|---|---|
| `fabricatedSnippet` | −1.5 | Grounding: quoted code must exist verbatim at the cited `file:line`. |
| `mislabeledNearMiss` | −1.5 | the structural-adjacent-but-distinct trap (an `isNull(processedAt)` filter sold as a soft-delete). |
| `judgedOrRanked` | −1.0 | Scope: "no evaluation — don't rank, critique, or recommend". |
| `noMatchHandledCorrectly` | discriminator (visibility, not weighted) | zero-match tasks: must say `No matches found for: …`, never invent one. |

Mirror the design's weights where it names them (pattern-finder's `−1.5 no-fabricated-snippet`); pick the softer ones by analogy to the core penalties. Put the contract rule in each boolean's `description` so the judge scores it without extra prompting. (This was a cold-follow gap: the skill named the core rubric but not how to score a new agent's contract.)

## Validate the harness before launch (zero-token dry-run)

Prove the harness's *logic* with **zero agents** before spending a real run — it catches the syntax + aggregation bugs that `ln`-style run noise never will. The file has a top-level `return` (valid in the Workflow runtime), so `node --check` rejects it; instead, in a throwaway node script:

1. Read the harness text, `.replace('export const meta','const meta')`.
2. Build it with the `AsyncFunction` constructor: `new (Object.getPrototypeOf(async()=>{}).constructor)('agent','parallel','pipeline','log','phase','args','budget','workflow', src)`.
3. Stub the hooks: `agent(prompt,opts)` returns **schema-shaped canned data** (branch on `opts.schema.required` — a load shape vs a route/judge shape); `parallel=(t)=>Promise.all(t.map(f=>f()))`; `pipeline=(items,...stages)=>` maps each item through the stages; `log=console.log`; `phase=()=>{}`.
4. Run it and assert: no throw, the report/decision is well-formed, every score ∈ [0,1] and not `NaN`, cell/probe counts match. Vary the stub by candidate (parse `opts.label`) to confirm the decision rule fires (`ship: opus` only at margin ≥ 0.05 AND n ≥ 3).

This is how the routing + execution harnesses were de-risked before every launch (2026-06-03). Re-run it after every harness edit — it's free.

## Model & effort decision rule

Default **sonnet** for every agent. Adopt **opus** only if, on the deciding (variance-controlled) axis, `mean(opus) ≥ mean(sonnet) + 0.05` AND opus isn't dragged by over-templating. Bar haiku for anything needing anti-hallucination discipline (§14.1: haiku could not follow the CRITICAL rules in 2026-05-04 testing).

**Model choice is task-shaped, not class-shaped.** Proven across three runs:
- `codebase-analyzer` = **opus** — deep CODE tracing rewards it.
- `thoughts-analyzer`, `docs-analyzer` = **sonnet** — on PROSE distillation, opus over-templates/pads (appends unrequested sections), losing scope/length points faster than its grounding edge earns. Don't reason "analyzer = deep = opus".
- Nuance: opus's padding is **open-ended-distillation-shaped** — on a pointed "what is X and its Status?" it was clean; on "summarize this as shipped" it padded. Sonnet still wins (opus = no upside + higher cost).
- **2026-09-30 (Sonnet 5.5):** the class rule flipped on code tracing — `codebase-analyzer` = **sonnet 5.5 @ xhigh** (0.969 vs Opus 5.5 medium 0.901, won on the stale-anchor task), while `codebase-pattern-finder` went **opus 5.5 @ medium** (0.963 vs best Sonnet 5.5 0.880; verbatim-snippet precedents). Sonnet 5.5's effort response is **non-monotonic** — analyzer medium 0.796, high 0.753 (8 grounding flags), xhigh 0.969 — so sweep every level; never interpolate.

### Effort — the second axis

Effort (`output_config.effort`) is a co-equal execution axis: per Opus 4.8 guidance it's "a dimension to test, not a fixed setting." It is **not symmetric with model**:

- **Switching is symmetric** — set `effort:` in the agent's frontmatter, exactly like `model:`. Always set it explicitly: tier defaults differ (Opus 4.8 / Sonnet 5 = `high`, **Opus 5.5 = `medium`**), so a bare model swap silently changes effort.
- **Testing is not** — there is **no per-spawn `effort` override** on the Agent tool or Workflow `agent()` (both expose per-spawn `model`, neither exposes `effort`; confirmed 2026-06-07). So you cannot put effort cells in `CANDS` and sweep them in one Workflow run the way you sweep model. Two routes:
  - **Path 2 (works today):** run the head-to-head once per `effort:` value — edit the frontmatter, restart to re-register, re-run — and compare the recorded per-run JSON across runs. Heavier, and the agent file changes between runs, so it carries the mid-run file-mutation/provenance caveat (§ Safety review): verify provenance before blaming a sub-agent.
  - **Path 1 (filed prerequisite):** a per-spawn `effort` opt mirroring `model` would let effort join `CANDS` and sweep in a single run. It's a harness change, not a skill change.
  - **Path 3 (preferred, 2026-09-24):** one throwaway variant file per `(model, effort)` cell — `.claude/agents/eval-<agent>--<o55|s5>-<effort>.md`, body byte-identical, only `name`/`model`/`effort` changed, description prefixed `[EVAL VARIANT — do not auto-route]`. One restart registers all; dispatch by `subagent_type`. Also the only way to target a full model ID (`claude-opus-4-8`, `claude-sonnet-5`) — per-spawn `model` takes aliases only. `rm` the variants after and confirm the roster count.

  - **Path 4 (headless nested dispatch, 2026-09-30):** drive the Path 3 variants from a script instead of the session — `claude -p --model haiku --output-format json --strict-mcp-config --mcp-config <file> --allowedTools Agent,<agent tools>` with a wrapper prompt (on **stdin** — variadic flags swallow a positional prompt) telling haiku to call the Agent tool once with `subagent_type "<variant>"` and relay verbatim. Read the report, model, effort and usage from the sub-agent transcript (`~/.claude/projects/<cwd-slug>/<session_id>/subagents/agent-*.jsonl`), not the relay. Scales to hundreds of runs with no session context cost; the relay adds ~$0.03–0.04/run (not counted in the cell's $/run). **Do not use `claude -p --agent <name>`** — it ignores frontmatter `effort:` (every cell runs at the session effort), so effort cells silently collapse into one.

**Always pin `effort:` — there is no `auto`.** The frontmatter enum is `low|medium|high|xhigh|max` (or an integer). An agent with **no** `effort:` line does *not* run at its model's tier default: it inherits the session `effortLevel` (user `~/.claude/settings.json`), clamped to the model's max — so an unpinned agent changes behaviour and cost whenever the operator changes their global effort (measured 2026-09-30: unpinned Sonnet 4.6 agents ran `high`, unpinned Opus 4.8 ran `xhigh`). Haiku 4.5 is the one exception: it accepts no effort, so leave the line off and say so in the research doc.

**Decision rule (2-D generalisation of the model rule):** across all `(model, effort)` cells, take the best mean; adopt the **cheapest cell within 0.05 of it**, quality first. Cost = **measured mean $/run** (Σ tokens by type × list price, mined from the sub-agent transcripts with `mine_subagents.py --session <sid> --out <fresh file>`), not tier rank — higher effort on a cheaper model can cost more. A gap under 10% is noise; say so. The miner counts usage once per `message.id` (the transcript repeats it on every content-block record) and floors `output_tokens` at chars/4 (mid-run records carry a stream-start snapshot, `tokens_out_estimated` flags it). Sanity-check a few runs against the Agent tool's `subagent_tokens` (≈ final context size ≈ Σ cache_create + input). Tests: `python3 .claude/eval/test_mine_subagents.py`. A higher effort earns its keep only at `mean ≥ incumbent + 0.05` — the same bar as a model bump.

**Authoritative support set (use it; don't probe).** Per the `claude-api` skill (`platform.claude.com/docs/…/effort`): effort works on Opus 4.5/4.6/4.7/4.8, Sonnet 4.6, Sonnet 5, Sonnet 5.5 (`claude-sonnet-5-5`, released 2026-09-28) and Opus 5.5; **Sonnet 4.6 supports only `low`/`medium`/`high`**, `max` is Opus-tier (4.6+), `xhigh` is Opus 4.7+, Haiku 4.5 errors entirely, and omitting effort == the tier default (`high` on 4.x / Sonnet 5 / Sonnet 5.5, `medium` on Opus 5.5). Opus 5.5, Sonnet 5 and Sonnet 5.5 accept all five levels (`low|medium|high|xhigh|max`); Sonnet 5.5 list price = Sonnet 5 ($2/$10/$2.50/$0.20 per M in/out/cache-write-5m/cache-read). It's a known static table — set frontmatter from it, and rely on it rather than Claude Code's `/effort` menu, which may surface levels a model doesn't support. An invalid `(model, effort)` cell just fails the spawn; that's the only check needed.

**Effort is observable (2026-09-30).** Every assistant record in a sub-agent transcript carries an `effort` field (and `perTurnEffort`). Record `model@effort` per run and fail the run if it differs from the cell — that check is what exposed the headless `--agent` collapse above. Two same-model effort cells within ~0.02 mean at near-identical spend are still effectively equivalent; say so rather than picking on noise.

**Operational notes (2026-09-24 run).**
- The `opus` alias resolves to Opus 5.5 — itself a candidate. Use a **mixed judge panel** (`opus` + `fable`) to blunt same-model self-preference.
- Cap concurrent Agent spawns at **20**; batch judges ≤4 prompts per judge agent, each scored independently, and rebatch missing ids after a 429.
- Read sub-agent reports from the **SubagentHandback** message, not the last assistant turn of the transcript (earlier extraction grabbed partial text).

**Operational notes (2026-09-30 fan-out run, Path 4).**
- **Judging dominates spend, not candidates.** Verify-first judges re-read the tree for every claim: ≈ $0.16/verdict for `opus` (0.08 verify → 0.37 web-research) and ≈ $0.52/verdict for `fable` (0.19 → 1.31), batches ≤4. 373 runs cost $52 (+ $13 relay); 717 verdicts cost $274 incl. failed/limit batches — ≈3× the plan's $70–100. Budget judges **per verdict × agent family**; web and design verdicts cost 2–3× code verdicts.
- **Price `claude -p` main-session calls with 1-hour cache writes** (2× input, e.g. Opus 5.5 $8/M, haiku $2/M); sub-agent transcripts use 5-minute writes (1.25×). Calibrate once against the CLI's `modelUsage[].costUSD` before summing — a wrong `fable` row overstated judge spend 2×.
- **`judge_cost_usd` in a verdict is the whole batch's cost.** Dedupe by `judge_session` before summing.
- **Spend limits fail fast and silently.** An org/session limit returns `total_cost_usd: 0` with a "You've hit your … limit" result (model `<synthetic>`) and no non-zero exit; runs and judges then "complete" in ~3 s as failures. Make every driver idempotent (skip work already on disk), reject `<synthetic>`/limit texts as results, and re-launch after the reset. Run each judge as its own `--judge-only opus|fable` process so one panel member's failures don't block the other.
- **Keep harness output off `/tmp` or recover from transcripts.** A reboot wiped `/tmp/eval` mid-run; every run and verdict was rebuilt from `~/.claude/projects/<cwd-slug>/` (relay prompt → task/cell by the `subagent_type` + `<<<PROMPT` text; judge sessions → verdicts by task text, disambiguated by the candidate's turn count). Nothing was re-bought, but write run/verdict JSON somewhere durable next time.
- **Check the oracle against a real run before judging.** The design-reviewer oracle assumed a fresh sign-up sees zero receipts; the smoke run proved the dev database is shared across users. Post-process browser transcripts into machine-checkable "harness facts" (tools, URLs, screenshot count, headings seen) and hand them to the judge — that is what makes contract-only judging of a browser agent honest.
- **Live-app evals leave residue.** Every design-review run signs up a throwaway user in the dev database and writes screenshots into the cwd; list the users in the research doc for cleanup.

## Judge-prompt pattern

- **Blinded**: pass only the task, the verified oracle, and the response text — never the candidate id/model.
- **Verify-first**: instruct the judge to `ls`/`grep`/Read the tree and confirm every claimed path/ADR/Status BEFORE scoring. Judges have tool access in a `Workflow`.
- **Structured output**: force a JSON schema of per-criterion booleans + a `verification` string + `rationale`. Add task-specific discriminator booleans when useful (e.g. `reportedSupersession`, `presentedStaleAsCurrent`).
- **Panel**: ≥2 judges on the deciding axis; average their §6.4 scores per run, then average runs per cell.

## Registry / bootstrap gotcha

A sub-agent file created **this session** is NOT in the harness's hot agent registry — `agentType: 'new-agent'` fails with "not found". Two options:
1. **Restart** the Claude Code session, then invoke the agents as real registered types (cleanest — drops the bootstrap confound).
2. **Adopt-on-disk bootstrap** (no restart): invoke a tool-equipped workflow agent with a preamble — *"Read `.claude/agents/<name>.md` in full and adopt everything below its frontmatter as your operating contract, then do: <task>"*. This exercises the exact prompt and forces a real Read. Document it as a caveat: the tool allowlist is then enforced by instruction, not the harness wrapper.

The native baseline (`Explore`) is always registered, so the comparison stays fair either way.

## Harness placement — the commit trap

Keep an adapted harness **inline** (paste it as the Workflow `script`) or in **`/tmp`**. Never save it under `.claude/eval/` or any other Biome-linted path: a top-level `return` (valid in the Workflow runtime) is a **Biome parse error**, and the husky pre-commit runs `make check` → Biome over `**`, so the bad parse **blocks every commit in the repo** until the file is moved. `.claude/skills/` is the one `.claude/` path Biome excludes (`biome.json`: `!.claude/skills`) — which is why the bundled `*-harness-template.js` files live there safely. To iterate, edit the copy the Workflow tool persists to the session dir (it returns the path), not a repo file.

## Safety review (mandatory after any multi-agent run)

- ☐ `git status --porcelain` — every change is inside the intended seam (the agent file(s), command wiring, research doc). `thoughts/` is gitignored, so the research doc won't appear — confirm it's on disk separately.
- ☐ `ls .claude/agents/*.md | wc -l` — roster count unchanged.
- ☐ `git restore` / remove anything written outside the seam.
- **Verify provenance before blaming a sub-agent.** If the working tree shifted mid-run, check `git reflog` + commit author first — it's usually the operator's own concurrent commit/branch switch, not a sub-agent. The registered agents' read-only-`Bash` fence makes a destructive sub-agent write unlikely; judges run with default tools, so still verify the seam.

## Lessons from the runs

- **Need headroom to discriminate.** A well-curated repo (explicit Status frontmatter, clear titles, cross-links) lets even `Explore@haiku` hit ~1.0 on analyze tasks — so the specialist *ties* rather than beats (confirmed four times, incl. the codebase webhook smoke). Build at least one hard/adversarial task, and report ties honestly. The specialist's edge often lives in LOCATE + routing discipline, not analyze accuracy.
- **Real-tool-invocation is a proxy** in a Workflow (no transcript `tool_uses` mid-run) — the judge's path-verification covers the fabricated-path case.
- **Variance is large — on locates too, not just prose.** A single run swings: one `codebase-locator@sonnet` run fabricated an `ln` naming scheme (2026-06-03 smoke) and flipped the decision rule to opus. The ≥3×≥2 control is what makes ANY model decision trustworthy — never decide from an n<3 cell.
- **A verify-first judge can be more correct than the oracle.** In the smoke the panel flagged the oracle's own PRODUCERS mislabel (only the enqueuer produces). Trust the tree; fix the oracle when the judge is right.
- **Corpus grows itself** — the `SubagentStop` harvest hook appends real runs to `corpus.jsonl`; mine before each eval to benchmark on real prompts.
