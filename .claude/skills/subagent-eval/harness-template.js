// Sub-agent head-to-head harness — TEMPLATE.
// Adapt the «FILL» blocks, then launch via the Workflow tool (paste inline as `script`).
// Pairs with .claude/skills/subagent-eval/{SKILL,REFERENCE}.md. Plain JS — no Date.now()/Math.random().

export const meta = {
  name: '«family»-agent-headtohead',                         // «FILL» e.g. docs-agent-headtohead
  description: 'Head-to-head: «family»-* specialist vs native Explore@baseline, blinded Opus panel scoring §6.3 with path/Status verification',
  phases: [
    { title: 'Run', detail: 'baseline vs specialist@sonnet vs specialist@opus' },
    { title: 'Judge', detail: 'blinded Opus panel, verifies claims vs tree' },
  ],
}

const ROOT = '«/abs/path/to/repo»'                            // «FILL» repo root, for judge verification
const SPECIALIST_REGISTERED = true                           // true after a restart; false = adopt-on-disk bootstrap (new agents)
const b = x => (x ? 1 : 0)

// §6.4 aggregation: clipped 0..1, denominator = sum of positive weights (9).
function agg(v) {
  const pos = 2 * b(v.taskCompletion) + 2 * b(v.realToolInvocation) + 2 * b(v.factualGrounding)
    + 1 * b(v.toolScoping) + 1 * b(v.stopDiscipline) + 1 * b(v.outputContract)
  const pen = 1.5 * b(v.hallucinatedPaths) + 1.5 * b(v.unsolicitedSuggestions)
    + 1.5 * b(v.refusedValidTask) + 0.5 * b(v.lengthBudgetExceeded)
  return Math.max(0, Math.min(1, (pos - pen) / 9))
}

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['taskCompletion', 'realToolInvocation', 'factualGrounding', 'toolScoping', 'stopDiscipline', 'outputContract', 'hallucinatedPaths', 'unsolicitedSuggestions', 'refusedValidTask', 'lengthBudgetExceeded', 'verification', 'rationale'],
  properties: {
    taskCompletion: { type: 'boolean', description: 'Satisfied the task per the oracle?' },
    realToolInvocation: { type: 'boolean', description: 'Cites REAL on-disk paths you verified (proxy for genuine tool use)?' },
    factualGrounding: { type: 'boolean', description: 'Claims carry verifiable refs you confirmed against the tree?' },
    toolScoping: { type: 'boolean', description: 'Stayed within role, no wasted scope?' },
    stopDiscipline: { type: 'boolean', description: 'Stopped without over-iterating?' },
    outputContract: { type: 'boolean', description: 'Matches the prescribed output format?' },
    hallucinatedPaths: { type: 'boolean', description: 'PENALTY: cited a path/ref not on disk (verify each)?' },
    unsolicitedSuggestions: { type: 'boolean', description: 'PENALTY: unrequested critique/recs, or self-inferred staleness an analyzer should have read from a recorded Status?' },
    refusedValidTask: { type: 'boolean', description: 'PENALTY: refused a valid task?' },
    lengthBudgetExceeded: { type: 'boolean', description: 'PENALTY: bloated past need?' },
    verification: { type: 'string', description: 'Exactly which paths/refs you checked and found.' },
    rationale: { type: 'string', description: '1-3 sentences.' },
    // «FILL optional»: add task-specific discriminator booleans (e.g. reportedSupersession) + list them in `required`.
  },
}

// «FILL»: one entry per benchmark task. kind drives runs/judges below.
// Mine real prompts (python3 .claude/eval/mine_subagents.py --print) + 1 golden + 1 adversarial.
// Each oracle MUST be verified against the tree before launching. Include >=1 HARD task with headroom.
const TASKS = [
  { id: 'LOCATE-1', kind: 'locate', agent: '«family»-locator', prompt: '«…»', oracle: '«verified ground truth; name the failure mode»' },
  { id: 'ADVERS-1', kind: 'locate', agent: '«family»-locator', prompt: '«a zero-match / trap»', oracle: '«none → must return a no-match statement; any cited path is a hallucination»' },
  { id: 'ANALYZE-1', kind: 'analyze', agent: '«family»-analyzer', prompt: '«…»', oracle: '«verified; the discriminating detail»' },
]

// `model` is a per-spawn override, so it sweeps in one run. `effort` is NOT — there is no
// per-spawn effort opt today, so don't add effort cells here expecting them to take; test effort
// via Path 2 (one run per `effort:` frontmatter value). See REFERENCE.md § Model & effort decision.
const CANDS = [
  { id: 'explore-haiku', kind: 'baseline', model: 'haiku' },  // production baseline — always registered
  { id: 'specialist-sonnet', kind: 'specialist', model: 'sonnet' },
  { id: 'specialist-opus', kind: 'specialist', model: 'opus' },
]

function bootstrapPreamble(agent, prompt) {
  return `You are operating AS the \`${agent}\` sub-agent. FIRST, Read \`.claude/agents/${agent}.md\` in full and adopt everything below its frontmatter as your operating contract (Grounding, Scope, Strategy, Output, Rules), obeying its read-only tool discipline. THEN do the task, producing ONLY its prescribed output:\n\n${prompt}`
}

async function runCandidate(task, cand) {
  if (cand.kind === 'baseline') {
    return await agent(task.prompt, { agentType: 'Explore', model: cand.model, label: `${task.id}:${cand.id}`, phase: 'Run' })
  }
  if (SPECIALIST_REGISTERED) {
    return await agent(task.prompt, { agentType: task.agent, model: cand.model, label: `${task.id}:${cand.id}`, phase: 'Run' })
  }
  return await agent(bootstrapPreamble(task.agent, task.prompt), { model: cand.model, label: `${task.id}:${cand.id}`, phase: 'Run' })
}

function judgePrompt(task, output) {
  return 'You are a STRICT, BLINDED evaluator scoring ONE response against a verified oracle, on the §6.3 rubric. Repo root: ' + ROOT + '. VERIFY every path/ref/Status the response claims by inspecting the tree (Bash ls/grep/sed, or Read) BEFORE scoring — do not trust the response.\n\n'
    + 'TASK (kind=' + task.kind + '):\n' + task.prompt + '\n\nVERIFIED ORACLE:\n' + task.oracle + '\n\n'
    + 'RESPONSE TO SCORE (author hidden):\n"""\n' + output + '\n"""\n\n'
    + 'Score each criterion (see schema). Penalties are true when the bad thing happened. Put the paths/refs you checked in `verification`, 1-3 sentences in `rationale`. Be harsh on grounding.'
}

// Run matrix: variance-control the DECIDING archetype(s) — the axis whose quality drives the
// model decision — at >=3 runs x >=2 judges; everything else is a low-variance 1x1 scout.
// Set DECIDING_KINDS to whatever archetype THIS agent serves, NOT literally 'analyze':
// a pattern-finder's deciding axis is 'pattern', a locator-only agent's is 'locate'. Copying
// `=== 'analyze'` verbatim silently gives a third archetype 1x1 cells and breaks the n>=3 rule
// (a cold-follow run for codebase-pattern-finder hit exactly this, 2026-06-03).
const DECIDING_KINDS = ['analyze']                           // «FILL» the model-deciding archetype(s) for this agent
const work = []
for (const t of TASKS) for (const c of CANDS) {
  const deciding = DECIDING_KINDS.includes(t.kind)
  const runs = deciding ? 3 : 1
  const nJudges = deciding ? 2 : 1
  for (let r = 0; r < runs; r++) work.push({ task: t, cand: c, run: r, nJudges })
}
log(`${work.length} candidate runs; registered=${SPECIALIST_REGISTERED}.`)

const scored = await pipeline(
  work,
  async (item) => {
    const output = await runCandidate(item.task, item.cand)
    if (!output || !String(output).trim()) throw new Error('empty output')
    return { ...item, output: String(output) }
  },
  (prev) => parallel(Array.from({ length: prev.nJudges }, (_, j) => () =>
    agent(judgePrompt(prev.task, prev.output), { model: 'opus', label: `judge${j + 1}:${prev.task.id}:${prev.cand.id}#${prev.run}`, phase: 'Judge', schema: JUDGE_SCHEMA })
  )).then(js => ({ ...prev, verdicts: js.filter(Boolean) }))
)

// Aggregate: judges -> run -> cell (task×candidate) -> overall per candidate.
const runs = scored.filter(Boolean).filter(r => r.verdicts?.length).map(r => {
  const js = r.verdicts.map(agg)
  return {
    taskId: r.task.id, kind: r.task.kind, candidateId: r.cand.id, model: r.cand.model, run: r.run,
    runScore: Number((js.reduce((a, x) => a + x, 0) / js.length).toFixed(3)), verdicts: r.verdicts, outputExcerpt: r.output.slice(0, 1400)
  }
})
const cellMap = {}
for (const r of runs) (cellMap[`${r.taskId}::${r.candidateId}`] ||= { taskId: r.taskId, candidateId: r.candidateId, model: r.model, s: [] }).s.push(r.runScore)
const cells = Object.values(cellMap).map(c => ({ ...c, meanScore: Number((c.s.reduce((a, x) => a + x, 0) / c.s.length).toFixed(3)), nRuns: c.s.length }))

function meanOver(kind, candId) {
  const cs = cells.filter(c => runs.find(r => r.taskId === c.taskId && r.kind === kind) && c.candidateId === candId)
  return cs.length ? Number((cs.reduce((a, c) => a + c.meanScore, 0) / cs.length).toFixed(3)) : null
}

// Decision rule: default sonnet; adopt opus only if mean(opus) >= mean(sonnet)+0.05
// AND the deciding axis is variance-controlled (>=3 runs). A single run can fabricate and flip
// the rule to opus on noise (the `ln` incident, 2026-06-03 smoke) — never promote from an n<3 cell.
const decision = {}
for (const kind of DECIDING_KINDS) {
  const sonnet = meanOver(kind, 'specialist-sonnet'), opus = meanOver(kind, 'specialist-opus'), base = meanOver(kind, 'explore-haiku')
  const decidingN = Math.min(Infinity, ...cells.filter(c => runs.find(r => r.taskId === c.taskId && r.kind === kind)).map(c => c.nRuns))
  const promote = opus != null && sonnet != null && opus - sonnet >= 0.05
  decision[kind] = {
    baseline: base, sonnet, opus, decidingN, beatsBaseline: sonnet != null && base != null && sonnet > base,
    ship: promote ? (decidingN >= 3 ? 'opus' : `inconclusive: opus>sonnet but deciding axis n=${decidingN}<3 — re-run >=3x>=2 before promoting`) : 'sonnet'
  }
  log(`${kind}: baseline=${base} sonnet=${sonnet} opus=${opus} n=${decidingN} -> ${decision[kind].ship}`)
}

return { decision, cells, runs }
