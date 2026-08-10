#!/bin/bash
# Post-tool hook for Claude Code. Reads the Edit/Write/MultiEdit tool result
# from stdin, extracts the modified file path, and runs biome format, lint and
# import sorting on it. Silently no-ops for files biome doesn't handle
# (.md, images, etc.) and for # any biome failure — formatting is best-effort,
# not a blocking check.

FILE=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

if [ -z "$FILE" ]; then
  exit 0
fi

"$CLAUDE_PROJECT_DIR/node_modules/.bin/biome" check \
  --write \
  --files-ignore-unknown=true \
  "$FILE" 2>/dev/null || true
