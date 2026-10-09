#!/usr/bin/env python3
"""Unit tests for mine_subagents token accounting. Run: python3 .claude/eval/test_mine_subagents.py"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mine_subagents as ms  # noqa: E402

START = {"input_tokens": 2, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 500, "output_tokens": 2}


def _assistant(msg_id, block, usage, model="claude-opus-4-8"):
    return {"type": "assistant", "message": {"id": msg_id, "model": model, "content": [block], "usage": usage}}


def _write(records) -> Path:
    fh = tempfile.NamedTemporaryFile("w", suffix=".jsonl", prefix="agent-t", delete=False)
    for r in records:
        fh.write(json.dumps(r) + "\n")
    fh.close()
    return Path(fh.name)


class TokenAccounting(unittest.TestCase):
    def test_blocks_of_one_message_count_usage_once(self):
        fp = _write([
            {"type": "user", "message": {"content": "task"}},
            _assistant("m1", {"type": "thinking", "thinking": ""}, START),
            _assistant("m1", {"type": "text", "text": "ok"}, START),
            _assistant("m1", {"type": "tool_use", "input": {"a": 1}}, START),
        ])
        run = ms.extract_run(fp)
        self.assertEqual((run.tokens_in, run.tokens_cache_create, run.tokens_cache_read), (2, 1000, 500))
        self.assertEqual((run.n_assistant_msgs, run.n_tool_uses), (1, 1))

    def test_stale_output_snapshot_floors_to_emitted_chars(self):
        fp = _write([
            {"type": "user", "message": {"content": "task"}},
            _assistant("m1", {"type": "text", "text": "x" * 400}, START),
            _assistant("m1", {"type": "tool_use", "input": {"q": "y" * 390}}, START),
        ])
        run = ms.extract_run(fp)
        # 400 text chars + json.dumps({"q": 390 y's}) = 400 + 399 -> 799 // 4
        self.assertEqual(run.tokens_out, 799 // 4)
        self.assertTrue(run.tokens_out_estimated)

    def test_final_usage_wins_when_larger_than_estimate(self):
        final = {**START, "output_tokens": 900}
        fp = _write([
            {"type": "user", "message": {"content": "task"}},
            _assistant("m1", {"type": "text", "text": "short"}, START),
            _assistant("m1", {"type": "text", "text": "done"}, final),
        ])
        run = ms.extract_run(fp)
        self.assertEqual(run.tokens_out, 900)
        self.assertFalse(run.tokens_out_estimated)

    def test_separate_messages_sum(self):
        fp = _write([
            {"type": "user", "message": {"content": "task"}},
            _assistant("m1", {"type": "text", "text": "a"}, START),
            _assistant("m2", {"type": "text", "text": "b"}, START),
        ])
        run = ms.extract_run(fp)
        self.assertEqual((run.tokens_cache_create, run.n_assistant_msgs), (2000, 2))


class Prices(unittest.TestCase):
    def test_specific_ids_beat_opus_4_catch_all(self):
        def key(model):
            return next(k for k in ms.PRICES if model.startswith(k))
        self.assertEqual(key("claude-opus-4-8"), "claude-opus-4-8")
        self.assertEqual(key("claude-opus-5-5"), "claude-opus-5-5")
        self.assertEqual(key("claude-sonnet-5-5"), "claude-sonnet-5-5")
        self.assertEqual(key("claude-sonnet-5-5-20260928"), "claude-sonnet-5-5")
        self.assertEqual(key("claude-sonnet-5"), "claude-sonnet-5")
        self.assertEqual(key("claude-haiku-4-5-20251001"), "claude-haiku-4-5")
        self.assertEqual(key("claude-opus-4-1"), "claude-opus-4")


if __name__ == "__main__":
    unittest.main()
