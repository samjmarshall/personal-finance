#!/usr/bin/env python3
"""Spike: mine sub-agent execution tuples from Claude Code's local transcripts.

Proves the "Mined" bucket (§5) of
thoughts/designs/2026-04-21-sub-agent-eval-pipeline.md: real
``(agent, prompt, output, tokens, latency)`` tuples are recoverable, offline,
from the transcripts Claude Code already writes — no OTEL, no re-running:

    ~/.claude/projects/<encoded-project>/<sessionId>/subagents/agent-<id>.jsonl   (execution)
    ~/.claude/projects/<encoded-project>/<sessionId>.jsonl                        (routing)

Schema verified empirically against real sessions on Claude Code 2.1.160:
  - agent     -> `attributionAgent` (real custom name; the dimension OTEL metrics
                  redact to "custom"). Cross-checked against the parent's
                  Agent tool_use `subagent_type`.
  - prompt    -> first `user` message text (the task the sub-agent received).
  - output    -> last non-empty `assistant` message text (the returned result).
  - tokens    -> sum of `message.usage` across assistant turns (the cost signal).
  - latency   -> last `timestamp` - first `timestamp` (wall-clock, incl. tool time).

stdlib only. Examples:
    python3 .claude/eval/mine_subagents.py --print --dry-run        # current repo, no write
    python3 .claude/eval/mine_subagents.py --print                  # write corpus.jsonl
    python3 .claude/eval/mine_subagents.py --session <id> --print
    python3 .claude/eval/mine_subagents.py --cwd ~/some/other/repo --print
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

PROJECTS_ROOT = Path.home() / ".claude" / "projects"
DEFAULT_OUT = Path(__file__).resolve().parent / "mined" / "corpus.jsonl"

# PLACEHOLDER list prices (USD per 1M tokens). Pricing drifts — VERIFY before
# trusting any dollar figure. Only used when --estimate-cost is passed.
PRICES = {
    "claude-haiku-4-5": {"in": 1.00, "out": 5.00, "cache_read": 0.10, "cache_create": 1.25},
    "claude-sonnet-4-6": {"in": 3.00, "out": 15.00, "cache_read": 0.30, "cache_create": 3.75},
    "claude-opus-4": {"in": 15.00, "out": 75.00, "cache_read": 1.50, "cache_create": 18.75},
}


def encode_project(path) -> str:
    """`/Users/sam/workspace/samjmarshall/personal-finance` -> `-Users-sam-workspace-samjmarshall-personal-finance`.

    Both `/` and `.` map to `-`, matching Claude Code's project-dir encoding
    (e.g. `/repo/.worktrees/x` -> `-repo--worktrees-x`).
    """
    return re.sub(r"[/.]", "-", str(Path(path).expanduser().resolve()))


def _iter_jsonl(fp: Path):
    try:
        with open(fp, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def _text_of(content) -> str:
    """Concatenate text from a message `content` (a str, or a list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            b["text"]
            for b in content
            if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
        )
    return ""


def _parse_ts(ts):
    if not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class SubAgentRun:
    agent: str
    agent_id: str
    session_id: str
    model: str
    prompt: str
    output: str
    prompt_chars: int
    output_chars: int
    n_assistant_msgs: int
    n_tool_uses: int
    tokens_in: int
    tokens_out: int
    tokens_cache_read: int
    tokens_cache_create: int
    tokens_total: int
    latency_s: float
    started_at: str
    source_file: str
    # routing enrichment (best-effort, joined from the parent transcript)
    routed_subagent_type: str | None = None
    routed_description: str | None = None
    cost_usd_est: float | None = None


def extract_run(fp: Path) -> SubAgentRun | None:
    """Pull the (agent, prompt, output, tokens, latency) tuple from one sub-agent file."""
    records = list(_iter_jsonl(fp))
    if not records:
        return None

    agent = next((r.get("attributionAgent") for r in records if r.get("attributionAgent")), None)
    agent_id = next(
        (r.get("agentId") for r in records if r.get("agentId")),
        fp.stem[len("agent-"):] if fp.stem.startswith("agent-") else fp.stem,
    )
    session_id = next((r.get("sessionId") for r in records if r.get("sessionId")), "")

    # prompt = text of the first user turn (the task handed to the sub-agent)
    prompt = ""
    for r in records:
        if r.get("type") == "user":
            prompt = _text_of(r.get("message", {}).get("content"))
            if prompt:
                break

    assistants = [r for r in records if r.get("type") == "assistant"]
    model = next((a.get("message", {}).get("model") for a in assistants if a.get("message", {}).get("model")), "")

    # output = last assistant turn that carries text (the result returned to the parent)
    output = ""
    for a in reversed(assistants):
        txt = _text_of(a.get("message", {}).get("content"))
        if txt.strip():
            output = txt
            break

    ti = to = tcr = tcc = n_tool_uses = 0
    for a in assistants:
        msg = a.get("message", {})
        u = msg.get("usage") or {}
        ti += u.get("input_tokens") or 0
        to += u.get("output_tokens") or 0
        tcr += u.get("cache_read_input_tokens") or 0
        tcc += u.get("cache_creation_input_tokens") or 0
        content = msg.get("content")
        if isinstance(content, list):
            n_tool_uses += sum(1 for b in content if isinstance(b, dict) and b.get("type") == "tool_use")

    stamps = [t for t in (_parse_ts(r.get("timestamp")) for r in records) if t]
    started = min(stamps) if stamps else None
    latency = (max(stamps) - min(stamps)).total_seconds() if len(stamps) >= 2 else 0.0

    return SubAgentRun(
        agent=agent or "unknown",
        agent_id=agent_id,
        session_id=session_id,
        model=model,
        prompt=prompt,
        output=output,
        prompt_chars=len(prompt),
        output_chars=len(output),
        n_assistant_msgs=len(assistants),
        n_tool_uses=n_tool_uses,
        tokens_in=ti,
        tokens_out=to,
        tokens_cache_read=tcr,
        tokens_cache_create=tcc,
        tokens_total=ti + to + tcr + tcc,
        latency_s=round(latency, 2),
        started_at=started.isoformat() if started else "",
        source_file=str(fp),
    )


def routing_map(parent_fp: Path) -> dict:
    """Map agentId -> {subagent_type, description} from a parent session transcript.

    Links the parent's `tool_result` record (which carries `toolUseResult.agentId`)
    back to the originating `Agent` tool_use via `tool_use_id`.
    """
    records = list(_iter_jsonl(parent_fp))
    agent_calls = {}  # tool_use_id -> {subagent_type, description}
    for r in records:
        if r.get("type") != "assistant":
            continue
        for b in r.get("message", {}).get("content") or []:
            if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in ("Agent", "Task"):
                agent_calls[b.get("id")] = {
                    "subagent_type": b.get("input", {}).get("subagent_type"),
                    "description": b.get("input", {}).get("description"),
                }

    out = {}
    for r in records:
        tur = r.get("toolUseResult")
        aid = tur.get("agentId") if isinstance(tur, dict) else None
        if not aid:
            continue
        tuid = None
        for b in r.get("message", {}).get("content") or []:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                tuid = b.get("tool_use_id")
                break
        info = agent_calls.get(tuid)
        if info:
            out[aid] = info
    return out


def enrich_routing(run: SubAgentRun, project_dir: Path, cache: dict) -> None:
    """Best-effort: attach the parent's subagent_type + description to a run."""
    parent_fp = project_dir / f"{run.session_id}.jsonl"
    if not parent_fp.exists():
        return
    if run.session_id not in cache:
        cache[run.session_id] = routing_map(parent_fp)
    info = cache[run.session_id].get(run.agent_id)
    if info:
        run.routed_subagent_type = info.get("subagent_type")
        run.routed_description = info.get("description")


def reenrich_corpus(out_fp: Path, session: str | None = None) -> int:
    """Backfill routing for corpus rows missing it, rewriting out_fp in place.

    The `SubagentStop` hook fires before the parent transcript flushes the
    delegation's tool_result, so a live-captured row often lacks
    routed_subagent_type. Re-joining later (parent now flushed) self-heals it.
    Returns the number of rows updated.
    """
    if not out_fp.exists():
        return 0
    rows = list(_iter_jsonl(out_fp))
    cache: dict = {}
    updated = 0
    for row in rows:
        if row.get("routed_subagent_type"):
            continue
        if session and row.get("session_id") != session:
            continue
        src, sid, aid = row.get("source_file"), row.get("session_id"), row.get("agent_id")
        if not (src and sid and aid):
            continue
        # source_file = <proj>/<session>/subagents/agent-<id>.jsonl  ->  <proj> is 3 up
        parent_fp = Path(src).parent.parent.parent / f"{sid}.jsonl"
        if not parent_fp.exists():
            continue
        if sid not in cache:
            cache[sid] = routing_map(parent_fp)
        info = cache[sid].get(aid)
        if info and info.get("subagent_type"):
            row["routed_subagent_type"] = info.get("subagent_type")
            row["routed_description"] = info.get("description")
            updated += 1
    if updated:
        tmp = out_fp.with_suffix(out_fp.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        tmp.replace(out_fp)  # atomic
    return updated


def estimate_cost(run: SubAgentRun) -> float | None:
    key = next((k for k in PRICES if run.model.startswith(k)), None)
    if not key:
        return None
    p = PRICES[key]
    return round(
        (run.tokens_in * p["in"]
         + run.tokens_out * p["out"]
         + run.tokens_cache_read * p["cache_read"]
         + run.tokens_cache_create * p["cache_create"]) / 1_000_000,
        4,
    )


def discover(project_dir: Path, session: str | None):
    dirs = [project_dir / session / "subagents"] if session else sorted(project_dir.glob("*/subagents"))
    for d in dirs:
        if d.is_dir():
            yield from sorted(d.glob("agent-*.jsonl"))


def load_existing_ids(out_fp: Path) -> set:
    return {r["agent_id"] for r in _iter_jsonl(out_fp) if r.get("agent_id")} if out_fp.exists() else set()


def append_corpus(out_fp: Path, runs, existing_ids: set) -> int:
    out_fp.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with open(out_fp, "a", encoding="utf-8") as fh:
        for run in runs:
            if run.agent_id in existing_ids:
                continue
            fh.write(json.dumps(asdict(run), ensure_ascii=False) + "\n")
            existing_ids.add(run.agent_id)
            written += 1
    return written


def harvest(project_dir: Path, session: str | None, out_fp: Path, *,
            with_routing: bool = True, estimate: bool = False, limit: int | None = None,
            write: bool = True):
    """Discover -> extract -> (enrich) -> (cost) -> append. Returns (runs, n_written)."""
    files = list(discover(project_dir, session))
    if limit:
        files = files[-limit:]
    runs = [r for r in (extract_run(f) for f in files) if r]
    if with_routing:
        cache: dict = {}
        for r in runs:
            enrich_routing(r, project_dir, cache)
    if estimate:
        for r in runs:
            r.cost_usd_est = estimate_cost(r)
    existing = load_existing_ids(out_fp)
    n_written = append_corpus(out_fp, runs, existing) if write else 0
    return runs, n_written


def _fmt_summary(runs, n_written: int, out_fp: Path, *, wrote: bool) -> str:
    if not runs:
        return "No sub-agent transcripts found."
    rows = [("agent", "model", "lat_s", "tok_total", "tools", "out_ch", "routed_as")]
    for r in sorted(runs, key=lambda x: x.started_at):
        rows.append((
            r.agent[:24], (r.model or "-")[:22], f"{r.latency_s:.1f}",
            f"{r.tokens_total:,}", str(r.n_tool_uses), f"{r.output_chars:,}",
            (r.routed_subagent_type or "-")[:20],
        ))
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    lines = []
    for j, row in enumerate(rows):
        lines.append("  ".join(c.ljust(widths[i]) for i, c in enumerate(row)))
        if j == 0:
            lines.append("  ".join("-" * widths[i] for i in range(len(row))))

    by_agent: dict = {}
    for r in runs:
        by_agent[r.agent] = by_agent.get(r.agent, 0) + 1
    join_rate = sum(1 for r in runs if r.routed_subagent_type) / len(runs)
    total_tokens = sum(r.tokens_total for r in runs)
    name_mismatch = sum(
        1 for r in runs
        if r.routed_subagent_type and r.agent != "unknown" and r.routed_subagent_type != r.agent
    )

    footer = [
        "",
        f"runs={len(runs)}  agents={dict(sorted(by_agent.items()))}",
        f"total_tokens={total_tokens:,}  routing_join_rate={join_rate:.0%}  name_mismatches={name_mismatch}",
    ]
    if any(r.cost_usd_est is not None for r in runs):
        total_cost = sum(r.cost_usd_est or 0 for r in runs)
        footer.append(f"cost_usd_est_total=${total_cost:.4f}  ⚠ PLACEHOLDER prices — verify PRICES dict")
    footer.append(f"{'WROTE' if wrote else 'DRY-RUN (no write)'}: {n_written} new run(s) -> {out_fp}")
    return "\n".join(lines + footer)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--project-dir", help="Path to ~/.claude/projects/<encoded> dir (overrides --cwd).")
    src.add_argument("--cwd", help="Working dir to encode into a project name (default: current dir).")
    ap.add_argument("--projects-root", default=str(PROJECTS_ROOT))
    ap.add_argument("--session", help="Limit to a single sessionId.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="Corpus JSONL output path.")
    ap.add_argument("--no-routing", action="store_true", help="Skip the parent-transcript routing join.")
    ap.add_argument("--estimate-cost", action="store_true", help="Add cost_usd_est (PLACEHOLDER prices).")
    ap.add_argument("--limit", type=int, help="Only the N most recent transcripts.")
    ap.add_argument("--print", dest="do_print", action="store_true", help="Print a summary table.")
    ap.add_argument("--dry-run", action="store_true", help="Extract and summarize but do not write the corpus.")
    ap.add_argument("--reenrich", action="store_true",
                    help="Backfill routing for existing corpus rows missing it (parent flushed since capture); rewrites --out in place, no discovery.")
    args = ap.parse_args(argv)

    out_fp = Path(args.out).expanduser()

    if args.reenrich:
        n = reenrich_corpus(out_fp, args.session)
        print(f"re-enriched {n} corpus row(s) missing routing -> {out_fp}")
        return 0

    if args.project_dir:
        project_dir = Path(args.project_dir).expanduser()
    else:
        project_dir = Path(args.projects_root).expanduser() / encode_project(args.cwd or Path.cwd())

    if not project_dir.exists():
        print(f"error: project dir not found: {project_dir}", file=sys.stderr)
        return 1

    runs, n_written = harvest(
        project_dir, args.session, out_fp,
        with_routing=not args.no_routing, estimate=args.estimate_cost,
        limit=args.limit, write=not args.dry_run,
    )
    if args.do_print or args.dry_run:
        print(_fmt_summary(runs, n_written, out_fp, wrote=not args.dry_run))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
