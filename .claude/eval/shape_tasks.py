#!/usr/bin/env python3
"""Shape the mined sub-agent corpus into §5 "Mined" task candidates.

Reads .claude/eval/mined/corpus.jsonl (produced by mine_subagents.py) and, for each
agent that has a definition in .claude/agents/, emits a per-agent YAML of task
*candidates* for human curation (§5 of the eval-pipeline design):

  - execution tasks  : diverse, de-duplicated real task prompts the agent handled,
                       each with provenance + a short sample-output excerpt.
  - routing tasks    : positives (prompts that really routed to this agent) and
                       negatives (the most *confusable* prompts that routed elsewhere
                       — real cross-agent data to exercise the §6.2 "when-not" criterion).

Output is staging, not final: written to tasks/mined/<agent>.yaml, flagged
`_needs_review`, to be curated down to 5 and merged into tasks/per-agent/<agent>.yaml
alongside the hand-written golden + adversarial buckets.

On load it first heals any corpus rows whose routing join lagged the SubagentStop hook
(`reenrich_corpus`, "heal-on-read") so the corpus is complete at the batch consumption
point. Pass --no-heal to skip; it is a no-op under --dry-run.

stdlib + PyYAML. Examples:
    python3 .claude/eval/shape_tasks.py                       # all agents, 5 exec + 3 neg
    python3 .claude/eval/shape_tasks.py --per-agent 5 --negatives 3
    python3 .claude/eval/shape_tasks.py --agent codebase-locator --dry-run
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

HERE = Path(__file__).resolve().parent
DEFAULT_CORPUS = HERE / "mined" / "corpus.jsonl"
DEFAULT_AGENTS_DIR = HERE.parent / "agents"          # .claude/agents
DEFAULT_OUT_DIR = HERE / "tasks" / "mined"           # .claude/eval/tasks/mined

sys.path.insert(0, str(HERE))
import mine_subagents as ms  # noqa: E402  (sibling module; needs HERE on sys.path)

DEDUP_JACCARD = 0.85   # prompts more similar than this are treated as duplicates
EXCERPT_CHARS = 400

_WORD = re.compile(r"[a-z0-9]+")
_STOP = set(
    "the a an to of and or for in on at is are be this that with you your i it as from "
    "find locate analyze analyse repo file files code please return report".split()
)


def _tokens(s: str) -> frozenset:
    return frozenset(w for w in _WORD.findall((s or "").lower()) if len(w) > 2 and w not in _STOP)


def _jaccard(a: frozenset, b: frozenset) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _load_corpus(fp: Path) -> list:
    rows = []
    with open(fp, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return rows


def dedup(rows: list) -> list:
    """Drop near-duplicate prompts, keeping the richest (most tool_uses / output) one."""
    kept, kept_tokens = [], []
    for r in sorted(rows, key=lambda r: (r.get("n_tool_uses", 0), r.get("output_chars", 0)), reverse=True):
        t = _tokens(r.get("prompt", ""))
        if not t:
            continue
        if any(_jaccard(t, kt) > DEDUP_JACCARD for kt in kept_tokens):
            continue
        kept.append(r)
        kept_tokens.append(t)
    return kept


def diverse_pick(rows: list, n: int) -> list:
    """Greedy max-min: seed with the most-exercised run, then repeatedly add the
    prompt least similar to everything already picked. Maximises topical coverage."""
    if len(rows) <= n:
        return rows
    toks = [_tokens(r.get("prompt", "")) for r in rows]
    seed = max(range(len(rows)), key=lambda i: rows[i].get("n_tool_uses", 0))
    picked = [seed]
    while len(picked) < n:
        best_i, best_dist = None, -1.0
        for i in range(len(rows)):
            if i in picked:
                continue
            dist = 1.0 - max(_jaccard(toks[i], toks[j]) for j in picked)
            if dist > best_dist:
                best_dist, best_i = dist, i
        picked.append(best_i)
    return [rows[i] for i in picked]


def _provenance(r: dict) -> dict:
    return {
        "agent_id": r.get("agent_id"),
        "session_id": r.get("session_id"),
        "model": r.get("model"),
        "latency_s": r.get("latency_s"),
        "tokens_total": r.get("tokens_total"),
        "n_tool_uses": r.get("n_tool_uses"),
        "source_file": r.get("source_file"),
    }


def _excerpt(s: str) -> str:
    s = (s or "").strip()
    return s if len(s) <= EXCERPT_CHARS else s[:EXCERPT_CHARS].rstrip() + " …"


def negatives_for(agent: str, picked_by_agent: dict, k: int) -> list:
    """Most confusable prompts from OTHER agents (highest similarity to this agent's
    picked prompts) — the hardest, most useful routing negatives."""
    own = [_tokens(r.get("prompt", "")) for r in picked_by_agent.get(agent, [])]
    if not own:
        return []
    cands = []
    for other, rows in picked_by_agent.items():
        if other == agent:
            continue
        for r in rows:
            sim = max((_jaccard(_tokens(r.get("prompt", "")), o) for o in own), default=0.0)
            cands.append((sim, other, r))
    cands.sort(key=lambda x: -x[0])
    return cands[:k]


def build_doc(agent: str, picked: list, picked_by_agent: dict, n_negatives: int, total_available: int) -> dict:
    execution = [
        {
            "id": f"mined-{agent}-exec-{i}",
            "kind": "execution",
            "prompt": r.get("prompt", ""),
            "provenance": _provenance(r),
            "sample_output_excerpt": _excerpt(r.get("output", "")),
        }
        for i, r in enumerate(picked, 1)
    ]
    positives = [
        {"id": f"mined-{agent}-route-pos-{i}", "kind": "routing", "expect_invoke": True,
         "prompt": r.get("prompt", "")}
        for i, r in enumerate(picked, 1)
    ]
    negatives = [
        {"id": f"mined-{agent}-route-neg-{i}", "kind": "routing", "expect_invoke": False,
         "actual_route": other, "confusability": round(sim, 3), "prompt": r.get("prompt", "")}
        for i, (sim, other, r) in enumerate(negatives_for(agent, picked_by_agent, n_negatives), 1)
    ]
    return {
        "agent": agent,
        "_generated_by": "shape_tasks.py from .claude/eval/mined/corpus.jsonl",
        "_needs_review": True,
        "_note": ("Auto-mined §5 candidates. Curate to 5, then merge into "
                  "tasks/per-agent/%s.yaml alongside golden + adversarial buckets." % agent),
        "_mined_available": total_available,
        "_mined_emitted": len(execution),
        "execution": execution,
        "routing": {"positives": positives, "negatives": negatives},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    ap.add_argument("--agents-dir", default=str(DEFAULT_AGENTS_DIR))
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    ap.add_argument("--per-agent", type=int, default=5, help="Target execution tasks per agent (§5: 5).")
    ap.add_argument("--negatives", type=int, default=3, help="Routing negatives per agent.")
    ap.add_argument("--agent", help="Only this agent.")
    ap.add_argument("--dry-run", action="store_true", help="Summarize; do not write YAML or heal the corpus.")
    ap.add_argument("--no-heal", action="store_true",
                    help="Skip the heal-on-read re-enrich of the corpus before shaping.")
    args = ap.parse_args(argv)

    if yaml is None and not args.dry_run:
        print("error: PyYAML not available. Install it, or use --dry-run.", file=sys.stderr)
        return 1

    corpus_fp = Path(args.corpus).expanduser()
    if not corpus_fp.exists():
        print(f"error: corpus not found: {corpus_fp} (run mine_subagents.py first)", file=sys.stderr)
        return 1

    eval_targets = {p.stem for p in Path(args.agents_dir).expanduser().glob("*.md")}
    if not eval_targets:
        print(f"error: no agent definitions in {args.agents_dir}", file=sys.stderr)
        return 1

    # Heal-on-read: backfill routing for rows whose join lagged the SubagentStop hook
    # (the last sub-agent of each session). Runs exactly at the batch consumption point.
    if args.dry_run:
        print("(dry-run: skipping heal-on-read corpus re-enrich)\n")
    elif not args.no_heal:
        healed = ms.reenrich_corpus(corpus_fp)
        if healed:
            print(f"heal-on-read: re-enriched {healed} corpus row(s) missing routing\n")

    rows = _load_corpus(corpus_fp)
    by_agent: dict = {}
    skipped_builtins: dict = {}
    for r in rows:
        a = r.get("agent")
        if not a or not r.get("prompt"):
            continue
        if a in eval_targets:
            by_agent.setdefault(a, []).append(r)
        else:
            skipped_builtins[a] = skipped_builtins.get(a, 0) + 1

    # Pass 1: dedup + diverse-pick per agent (needed before cross-agent negatives).
    picked_by_agent, available = {}, {}
    for agent, agent_rows in by_agent.items():
        deduped = dedup(agent_rows)
        available[agent] = len(deduped)
        picked_by_agent[agent] = diverse_pick(deduped, args.per_agent)

    targets = [args.agent] if args.agent else sorted(eval_targets)
    out_dir = Path(args.out_dir).expanduser()
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    print(f"{'agent':<26} {'picked':>6} {'avail':>6} {'pos':>4} {'neg':>4}  status")
    print("-" * 70)
    written = 0
    for agent in targets:
        picked = picked_by_agent.get(agent, [])
        avail = available.get(agent, 0)
        if not picked:
            print(f"{agent:<26} {'0':>6} {'0':>6} {'-':>4} {'-':>4}  NO mined data — needs golden/adversarial or usage")
            continue
        doc = build_doc(agent, picked, picked_by_agent, args.negatives, avail)
        n_neg = len(doc["routing"]["negatives"])
        short = " ⚠ below §5 target of 5" if len(picked) < args.per_agent else ""
        status = f"ok{short}"
        if not args.dry_run:
            out_fp = out_dir / f"{agent}.yaml"
            with open(out_fp, "w", encoding="utf-8") as fh:
                yaml.safe_dump(doc, fh, sort_keys=False, allow_unicode=True, width=100, default_flow_style=False)
            written += 1
        print(f"{agent:<26} {len(picked):>6} {avail:>6} {len(picked):>4} {n_neg:>4}  {status}")

    missing = sorted(eval_targets - set(by_agent))
    if missing:
        print(f"\nno corpus rows for {len(missing)} eval target(s): {', '.join(missing)}")
    if skipped_builtins:
        print(f"skipped non-eval-target agents (not in .claude/agents/): {dict(sorted(skipped_builtins.items()))}")
    print(f"\n{'DRY-RUN — no files written' if args.dry_run else f'wrote {written} file(s) -> {out_dir}'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
