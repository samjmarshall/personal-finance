#!/bin/bash
# notify-hitl.sh — guaranteed audible alert + auto-raise the session's terminal/IDE
# for Claude Code HITL events (permission prompts, idle pauses).
# Invoked by the Notification hook in .claude/settings.json; receives hook JSON on stdin.
set -uo pipefail

# Hooks inherit the parent env, but normalize PATH so jq / open / afplay always resolve.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

HOOK_INPUT=$(cat)
TYPE=$(printf '%s' "$HOOK_INPUT" | jq -r '.notification_type // empty' 2>/dev/null || true)

case "$TYPE" in
  permission_prompt) SOUND="/System/Library/Sounds/Glass.aiff" ;;  # sharp — needs approval
  idle_prompt)       SOUND="/System/Library/Sounds/Tink.aiff"  ;;  # soft  — waiting on you
  *)                 SOUND="/System/Library/Sounds/Glass.aiff" ;;
esac

# 1) GUARANTEED audible alert — no permissions, unaffected by Focus/DND, works backgrounded.
if [ -f "$SOUND" ]; then
  afplay "$SOUND" &
else
  osascript -e 'beep' &
fi

# 2) RAISE the terminal/IDE running this session, so you land straight on it.
#    `open -b/-a` uses Launch Services — no Automation/Accessibility permission needed.
#    __CFBundleIdentifier is set by the GUI app that spawned the terminal and is inherited
#    here; it pinpoints the exact app, including VS Code forks (Cursor, VSCodium, Insiders).
if [ -n "${__CFBundleIdentifier:-}" ]; then
  open -b "$__CFBundleIdentifier" 2>/dev/null || true
else
  # Fallback when bundle id is absent (e.g. some remote/tmux setups): map TERM_PROGRAM.
  case "${TERM_PROGRAM:-}" in
    vscode)         open -a "Visual Studio Code" 2>/dev/null || true ;;
    iTerm.app)      open -a "iTerm"               2>/dev/null || true ;;
    Apple_Terminal) open -a "Terminal"            2>/dev/null || true ;;
    WezTerm)        open -a "WezTerm"             2>/dev/null || true ;;
    ghostty)        open -a "Ghostty"             2>/dev/null || true ;;
    *)              : ;;  # unknown / headless / remote — skip silently
  esac
fi

exit 0
