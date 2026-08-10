#!/usr/bin/env python3
"""Claude Code `SubagentStop` hook: harvest the just-finished sub-agent into the eval corpus.

Turns §5's one-time manual "Mined" extraction into a live, growing dataset — the
"shadow-eval from real usage" feed flagged as future work in §8.2 of
thoughts/designs/2026-04-21-sub-agent-eval-pipeline.md. As you (and Ralph runs)
use sub-agents, each completed run is appended to .claude/eval/mined/corpus.jsonl.

DESIGN NOTES
  - Trigger-only: the hook does NOT parse content itself. It derives the session's
    subagents dir from the hook's `transcript_path` and defers to mine_subagents,
    so there is one source of truth for the schema.
  - Robust to the open question in claude-code#7881 (sub-agent identification on
    SubagentStop): we re-scan the session's subagents dir and harvest by `agentId`,
    idempotently — we never depend on the hook telling us *which* sub-agent finished,
    nor on the community-documented `agent_transcript_path` / `last_assistant_message`
    fields (unconfirmed against the official reference as of this writing).
  - Never disrupts the session: always exits 0, prints nothing to stdout, and logs a
    single line to .claude/eval/mined/harvest.log.

WIRE-UP — add to .claude/settings.json (project) or ~/.claude/settings.json (user):

    {
      "hooks": {
        "SubagentStop": [
          {
            "hooks": [
              { "type": "command",
                "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/eval/harvest_hook.py\"" }
            ]
          }
        ]
      }
    }

Then restart Claude Code (or run /hooks and approve) so the new hook is loaded.
Verify: spawn any sub-agent, then `tail .claude/eval/mined/harvest.log` and
`wc -l .claude/eval/mined/corpus.jsonl`.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

OUT = HERE / "mined" / "corpus.jsonl"
LOG = HERE / "mined" / "harvest.log"


def _log(msg: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")
    except OSError:
        pass


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    try:
        import mine_subagents as ms
    except ImportError as exc:  # pragma: no cover - spike safety net
        _log(f"error: cannot import mine_subagents: {exc!r}")
        return

    # Locate the session's project dir + sessionId from the confirmed `transcript_path`.
    transcript_path = payload.get("transcript_path")
    session = None
    project_dir = None
    if transcript_path:
        p = Path(transcript_path)
        session = p.stem                     # "<sessionId>.jsonl" -> "<sessionId>"
        project_dir = p.parent               # ~/.claude/projects/<encoded>
    elif payload.get("cwd"):
        project_dir = Path(ms.PROJECTS_ROOT) / ms.encode_project(payload["cwd"])

    if not project_dir or not project_dir.exists():
        _log(f"skip: no usable project dir (transcript_path={transcript_path!r})")
        return

    try:
        runs, n_written = ms.harvest(project_dir, session, OUT, with_routing=True, write=True)
        # Self-heal: a SubagentStop fires before the parent transcript flushes the
        # delegation's tool_result, so the just-captured row's routing is usually null.
        # Backfilling here joins *prior* rows whose parent has since flushed. (The very
        # last sub-agent of a session has no later fire — `--reenrich` or the next full
        # mine mops it up.)
        healed = ms.reenrich_corpus(OUT, session=session)
        agents = sorted({r.agent for r in runs})
        _log(f"session={session} scanned={len(runs)} new={n_written} healed={healed} agents={agents}")
    except Exception as exc:  # never let a harvest error bubble into the session
        _log(f"error: {exc!r}")


if __name__ == "__main__":
    main()
    sys.exit(0)
