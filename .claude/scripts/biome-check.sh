#!/bin/bash
# Post-tool hook for Claude Code. Reads the Edit/Write/MultiEdit tool result
# from stdin, extracts the modified file path, and runs the `make fix` steps on
# it: format, lint, import sorting, braces (Biome) and blank lines (Oxlint).
# Silently no-ops for files the tools don't handle (.md, images, etc.) and for
# any tool failure — fixing is best-effort, not a blocking check.

FILE=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

if [ -z "$FILE" ]; then
  exit 0
fi

# Oxlint fixes any path it's handed, so leave other repos and gitignored folders alone.
case "$FILE" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

if git -C "$CLAUDE_PROJECT_DIR" check-ignore -q "$FILE"; then
  exit 0
fi

# Twice: Biome lints before it formats, so a long `if` it splits only gets braces on pass two.
for _ in 1 2; do
  "$CLAUDE_PROJECT_DIR/node_modules/.bin/biome" check \
    --write \
    --files-ignore-unknown=true \
    "$FILE" 2>/dev/null || true
done

"$CLAUDE_PROJECT_DIR/node_modules/.bin/oxlint" \
  -c "$CLAUDE_PROJECT_DIR/.oxlintrc.json" \
  --fix \
  "$FILE" 2>/dev/null || true
