// Sub-agent ROUTING-rubric harness — TEMPLATE (§6.2 pass).
// Companion to harness-template.js (which scores §6.3 EXECUTION). This one runs NO
// candidate — it scores the agent `description` field, the only thing the planner sees
// when choosing a tool. Use it after you edit descriptions or add an agent, to prove the
// description set routes real prompts to the right specialist and reads its when-not redirects.
// Adapt the «FILL» blocks, then launch via the Workflow tool (paste inline as `script`).
// Plain JS — no Date.now()/Math.random(). Lives under .claude/skills/ (biome-excluded; a
// top-level `return` here is fine — never save an adapted copy under .claude/eval/, see REFERENCE.md).

export const meta = {
  name: 'routing-rubric-pass',
  description: '§6.2 routing pass: score agent DESCRIPTIONS (no execution). Blinded Opus judges read on-disk descriptions, route probes among them (correct-invoke / non-invoke), and rate scope-clarity + verbosity.',
  phases: [
    { title: 'Load',  detail: 'read every candidate description from disk once' },
    { title: 'Route', detail: 'blinded judge routes each probe among the descriptions' },
    { title: 'Describe', detail: 'blinded judge rates each description: scope-clarity + verbosity' },
  ],
}

const ROOT = '«/abs/path/to/repo»'                          // «FILL» repo root

// «FILL» the routing pool — the agents the planner chooses among. Judges READ each file's
// `description:` frontmatter this run (no inlined/stale text). 'none' is always an implicit
// option = no specialist should claim it (a general-purpose/Explore agent handles it).
// Default = the full file-backed routing surface (all 11). The richer the pool, the more
// cross-family overlap a description has to survive. Trim to the agents you changed if you want.
const POOL = [
  { name: 'docs-locator',            file: '.claude/agents/docs-locator.md' },
  { name: 'docs-analyzer',           file: '.claude/agents/docs-analyzer.md' },
  { name: 'thoughts-locator',        file: '.claude/agents/thoughts-locator.md' },
  { name: 'thoughts-analyzer',       file: '.claude/agents/thoughts-analyzer.md' },
  { name: 'codebase-locator',        file: '.claude/agents/codebase-locator.md' },
  { name: 'codebase-analyzer',       file: '.claude/agents/codebase-analyzer.md' },
  { name: 'codebase-pattern-finder', file: '.claude/agents/codebase-pattern-finder.md' },
  { name: 'web-lookup',              file: '.claude/agents/web-lookup.md' },
  { name: 'web-research',            file: '.claude/agents/web-research.md' },
  { name: 'design-reviewer',         file: '.claude/agents/design-reviewer.md' },
  { name: 'codebase-verification',   file: '.claude/agents/codebase-verification.md' },
]

// «FILL» labelled probes. `expected` ∈ a POOL name or 'none'. Cover, per agent:
//   - a POSITIVE (a prompt that agent should win) — feeds correct-invoke,
//   - the RECIPROCAL-REDIRECT TRAPS that stress the when-not boundaries (docs⇄thoughts⇄codebase),
//   - NEGATIVES (expected:'none') a specialist must NOT grab — feeds non-invoke.
// Verify every `expected` against the tree NOW (the oracle is the routing decision a correct
// description set produces). Examples below are verified against this repo 2026-06-03.
const PROBES = [
  // positives — one per agent (baseline correct-invoke)
  { id: 'POS-docs-loc',    prompt: 'Which ADR governs the transactional outbox + Inngest-delivery design?', expected: 'docs-locator' },
  { id: 'POS-docs-an',     prompt: 'Using docs/adr/adr013-local-db-canonical-for-lead-data.md, what did we decide and what is its recorded Status?', expected: 'docs-analyzer' },
  { id: 'POS-thx-loc',     prompt: 'Find the design doc and any research notes on the sub-agent evaluation pipeline.', expected: 'thoughts-locator' },
  { id: 'POS-thx-an',      prompt: 'From thoughts/designs/2026-04-21-sub-agent-eval-pipeline.md, extract the key decisions and whether they still hold.', expected: 'thoughts-analyzer' },
  { id: 'POS-code-loc',    prompt: 'Where in the code does the outbox sweep cron live?', expected: 'codebase-locator' },
  { id: 'POS-code-an',     prompt: 'Walk through how the outbox sweep delivers events to Inngest, with file:line refs.', expected: 'codebase-analyzer' },
  { id: 'POS-code-pat',    prompt: 'Show me an existing example of a Drizzle pgTable schema that uses a partial index, so I can copy the pattern for a new table.', expected: 'codebase-pattern-finder' },
  { id: 'POS-web-lookup',  prompt: "What is the default behaviour of Zod v4's .trim() on z.string() — before or after the other validations run? Quote the official docs.", expected: 'web-lookup' },
  { id: 'POS-web-research',prompt: 'Survey the current best practices for implementing the transactional-outbox pattern, comparing the main approaches across multiple sources.', expected: 'web-research' },
  { id: 'POS-design',      prompt: 'Review the front-end changes on this branch for visual consistency, accessibility, and responsive behaviour across viewports.', expected: 'design-reviewer' },
  { id: 'POS-verify',      prompt: 'Run the build, lint/typecheck, and unit tests, and report whether they pass or fail.', expected: 'codebase-verification' },
  // reciprocal-redirect traps — authoritative docs/ vs speculative thoughts/
  { id: 'TRAP-ship-vs-spec', prompt: 'What did we decide and SHIP about Lead data being the canonical store, and is that decision still current?', expected: 'docs-analyzer' },   // executed decision (adr013) → NOT thoughts-analyzer
  { id: 'TRAP-spec-vs-ship', prompt: 'Distil the PROPOSED sub-agent eval design and whether the proposal still holds.', expected: 'thoughts-analyzer' },                          // speculative design → NOT docs-analyzer
  { id: 'TRAP-loc-spec',     prompt: 'Find the speculative design/plan docs about the sub-agent eval pipeline.', expected: 'thoughts-locator' },                                    // thoughts/ not docs/
  { id: 'TRAP-loc-decision', prompt: 'Which ADR is the system-of-record for the outbox-delivery decision?', expected: 'docs-locator' },                                            // docs/ not thoughts/
  // codebase-sibling disambiguation — find-example vs locate
  { id: 'CDIS-loc-vs-pat',   prompt: 'Find a working example of an Inngest function with a cron schedule that I can model a new cron job on.', expected: 'codebase-pattern-finder' },// copyable example → NOT codebase-locator
  // cross-family code-vs-web traps — our code vs external library docs
  { id: 'TRAP-web-vs-code',  prompt: 'Where is the default request timeout configured for our HubSpot client?', expected: 'codebase-locator' },                                     // OUR code → NOT web-lookup
  { id: 'TRAP-code-vs-web',  prompt: "What is the default retry behaviour of the Inngest SDK's step.run, according to the Inngest documentation?", expected: 'web-lookup' },         // external library docs → NOT codebase
  { id: 'TRAP-lookup-vs-research', prompt: 'Compare the trade-offs between Drizzle and Prisma for our stack, synthesising across multiple sources and benchmarks.', expected: 'web-research' }, // synthesis → NOT web-lookup
  // negatives — no read-only specialist should claim these
  { id: 'NEG-commit', prompt: 'Write a conventional-commit message for the staged changes.', expected: 'none' },
  { id: 'NEG-impl',   prompt: 'Refactor the outbox sweep to batch deliveries in groups of 50.', expected: 'none' },
]

const JUDGES_PER_PROBE = 2     // 1 scouts; ≥2 to trust a description CHANGE (mirrors §6.4 variance discipline)
const clamp = x => Math.max(0, Math.min(1, x))

const ROUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['chosen', 'readDescriptions', 'confidence', 'rationale'],
  properties: {
    chosen:           { type: 'string', description: "EXACT name of the one agent the planner should invoke, or 'none' if a general-purpose agent should handle it." },
    readDescriptions: { type: 'boolean', description: 'You based the choice on the provided descriptions, not on the agent names alone.' },
    confidence:       { type: 'string', enum: ['high', 'medium', 'low'] },
    rationale:        { type: 'string', description: '1-2 sentences: which when/when-not clause decided it.' },
  },
}

const DESC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['hasWhat', 'hasWhen', 'hasWhenNot', 'scopeClarity', 'wordCount', 'overSixtyWords', 'verbosityWithoutRoutingValue', 'rationale'],
  properties: {
    hasWhat:       { type: 'boolean', description: 'States WHAT the agent does (its surface).' },
    hasWhen:       { type: 'boolean', description: 'States WHEN to use it (positive trigger), beyond restating the what.' },
    hasWhenNot:    { type: 'boolean', description: 'States WHEN NOT to use it, with a reciprocal redirect to the right sibling.' },
    scopeClarity:  { type: 'number', enum: [0, 0.5, 1], description: '§6.2 3-point: 0 = only what (or vague); 0.5 = what + when; 1.0 = what + when + a reciprocal when-not.' },
    wordCount:     { type: 'integer', description: 'Words in the description field.' },
    overSixtyWords:{ type: 'boolean', description: 'wordCount > 60.' },
    verbosityWithoutRoutingValue: { type: 'boolean', description: 'PENALTY: over 60 words AND the surplus does NOT add routing value (a redirect/disambiguation IS routing value).' },
    rationale:     { type: 'string', description: '1-2 sentences.' },
  },
}

// ---- Phase 1: load every description from disk once (real Read; grounds the judges) ----
phase('Load')
const LOAD_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['descriptions'],
  properties: { descriptions: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['name', 'description'],
    properties: { name: { type: 'string' }, description: { type: 'string' } } } } },
}
const loaded = await agent(
  'Repo root: ' + ROOT + '. For EACH file below, Read it and return the verbatim text of its YAML frontmatter `description:` field (the routing signal) — no other lines. Files:\n'
    + POOL.map(a => `- ${a.name}: ${a.file}`).join('\n'),
  { label: 'load-descriptions', phase: 'Load', schema: LOAD_SCHEMA },
)
const DESize = {}
for (const d of (loaded?.descriptions || [])) DESize[d.name] = d.description
const present = POOL.filter(a => DESize[a.name])
if (present.length < 2) { log('FATAL: fewer than 2 descriptions loaded — check POOL paths.'); return { error: 'load-failed', loaded } }
log(`${present.length}/${POOL.length} descriptions loaded.`)

// The blinded routing menu: names + descriptions, NO ground-truth labels.
const MENU = present.map(a => `### ${a.name}\n${DESize[a.name]}`).join('\n\n')

function routePrompt(probe) {
  return 'You are a STRICT, BLINDED router emulating the planner that picks ONE Claude Code sub-agent for a user request, seeing ONLY each agent\'s description (its routing signal). '
    + 'Choose the single best-fitting agent, or "none" if no specialist fits and a general-purpose agent should handle it. Weigh each description\'s when / when-not clauses; respect reciprocal redirects (e.g. authoritative docs/ vs speculative thoughts/ vs code).\n\n'
    + 'CANDIDATE AGENTS:\n' + MENU + '\n\nUSER REQUEST:\n"""\n' + probe.prompt + '\n"""\n\n'
    + 'Return the exact chosen name (or "none"). Do not infer from the names alone — decide from the descriptions.'
}
function descPrompt(name) {
  return 'You are a STRICT evaluator scoring ONE Claude Code sub-agent DESCRIPTION on the §6.2 routing rubric (you are NOT running the agent). '
    + 'The description is the only routing signal the planner sees; good ones state what / when / when-not with reciprocal redirects, in <=60 words.\n\n'
    + 'AGENT: ' + name + '\nDESCRIPTION:\n"""\n' + DESize[name] + '\n"""\n\n'
    + 'Score scope-clarity (0/0.5/1.0 per schema), count the words, and decide the verbosity penalty (only if >60 words AND the surplus adds no routing value — a redirect counts as routing value).'
}

// ---- Phase 2 + 3: route every probe, and rate every description (independent, pipelined) ----
const routeWork = []
for (const p of PROBES) for (let j = 0; j < JUDGES_PER_PROBE; j++) routeWork.push({ probe: p, j })
const descWork = present.map(a => a.name)

const [routeScored, descScored] = await parallel([
  () => parallel(routeWork.map(w => () =>
    agent(routePrompt(w.probe), { label: `route:${w.probe.id}#${w.j}`, phase: 'Route', model: 'opus', schema: ROUTE_SCHEMA })
      .then(v => ({ probe: w.probe, verdict: v })).catch(() => null))),
  () => parallel(descWork.map(name => () =>
    parallel(Array.from({ length: 2 }, (_, j) => () =>
      agent(descPrompt(name), { label: `desc:${name}#${j}`, phase: 'Describe', model: 'opus', schema: DESC_SCHEMA }).catch(() => null)))
      .then(js => ({ name, verdicts: js.filter(Boolean) })))),
])

// ---- Aggregate per agent (§6.2): score = clip(0,1, (2·correctInvoke + 2·nonInvoke + 1·scopeClarity − 0.5·verbosity)/5) ----
// Majority-vote each probe's routing across its judges (ties → 'none').
const probeChoice = {}
for (const p of PROBES) {
  const votes = routeScored.filter(Boolean).filter(r => r.probe.id === p.id).map(r => r.verdict?.chosen).filter(Boolean)
  const tally = {}
  for (const c of votes) tally[c] = (tally[c] || 0) + 1
  let best = 'none', bestN = -1
  for (const [c, n] of Object.entries(tally)) if (n > bestN) { best = c; bestN = n }
  probeChoice[p.id] = { chosen: best, votes: tally, expected: p.expected }
}

const descAgg = {}
for (const d of descScored.filter(Boolean)) {
  const vs = d.verdicts
  if (!vs.length) continue
  const sc = vs.reduce((a, x) => a + x.scopeClarity, 0) / vs.length
  // penalty fires only if a majority of judges saw unjustified verbosity
  const pen = vs.filter(x => x.verbosityWithoutRoutingValue).length > vs.length / 2 ? 1 : 0
  descAgg[d.name] = { scopeClarity: Number(sc.toFixed(3)), verbosityPenalty: pen, wordCount: vs[0].wordCount }
}

const report = present.map(a => {
  const name = a.name
  const positives = PROBES.filter(p => p.expected === name)
  const negatives = PROBES.filter(p => p.expected !== name)
  const correctInvoke = positives.length ? positives.filter(p => probeChoice[p.id].chosen === name).length / positives.length : null
  const nonInvoke = negatives.length ? negatives.filter(p => probeChoice[p.id].chosen !== name).length / negatives.length : null
  const d = descAgg[name] || { scopeClarity: 0, verbosityPenalty: 0, wordCount: null }
  const ci = correctInvoke ?? 0, ni = nonInvoke ?? 0
  const score = clamp((2 * ci + 2 * ni + 1 * d.scopeClarity - 0.5 * d.verbosityPenalty) / 5)
  return { name, correctInvoke, nonInvoke, scopeClarity: d.scopeClarity, verbosityPenalty: d.verbosityPenalty, wordCount: d.wordCount, routingScore: Number(score.toFixed(3)) }
})

for (const r of report) log(`${r.name}: correct-invoke=${r.correctInvoke} non-invoke=${r.nonInvoke} scope=${r.scopeClarity} verbPen=${r.verbosityPenalty} -> ${r.routingScore}`)
// Misroutes worth reading by hand (trap failures live here):
const misroutes = PROBES.filter(p => probeChoice[p.id].chosen !== p.expected)
  .map(p => ({ id: p.id, prompt: p.prompt, expected: p.expected, got: probeChoice[p.id].chosen, votes: probeChoice[p.id].votes }))
log(`${misroutes.length}/${PROBES.length} probes misrouted.`)

return { report, probeChoice, misroutes }
