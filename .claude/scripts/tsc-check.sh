#!/bin/bash
# PostToolUse hook. Reads file_path from the Edit/Write/MultiEdit tool input,
# no-ops for non-TypeScript files, then runs tsc --noEmit over the whole project.

FILE=$(jq -r '.tool_input.file_path // empty')

case "$FILE" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" && tsc --noEmit
