#!/bin/bash
# Pre-tool hook for Claude Code. Blocks Read and Bash tool calls that would
# expose .env file contents. Reads the tool invocation from stdin as JSON.
#
# .env files hold secrets — use `make env_pull` to sync env vars from Vercel.
# Escape hatch for the user: run commands directly via the `!` prefix in the
# Claude prompt — hooks do not run on user-invoked shell commands.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL" = "Read" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
  if [ -z "$FILE_PATH" ]; then
    exit 0
  fi
  BASENAME=$(basename "$FILE_PATH")
  # Match .env, .env.local, .env.production, etc. but not .envrc or .environment
  if echo "$BASENAME" | grep -qE '^\.env(\.[a-zA-Z0-9_.-]+)?$'; then
    echo "BLOCKED: Reading '$FILE_PATH' is not allowed — .env files may contain secrets. Use \`make env_pull\` to sync env vars from Vercel." >&2
    exit 2
  fi
fi

if [ "$TOOL" = "Bash" ]; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
  # Check each line for a .env filename appearing as a path token.
  # Matches: cat .env, head /app/.env.local, grep SECRET .env.production
  # Does not match: NODE_ENV=, process.env.FOO, cat .envrc, cat .environment
  ENV_PATTERN='(^|[[:space:]]|/|"|'"'"')\.env(\.[a-zA-Z0-9_.-]+)?([[:space:]]|$|[";'"'"'|&>])'
  while IFS= read -r line; do
    if echo "$line" | grep -qE "$ENV_PATTERN"; then
      echo "BLOCKED: The command references a .env file — .env files may contain secrets. Use \`make env_pull\` to sync env vars from Vercel." >&2
      exit 2
    fi
  done <<< "$COMMAND"
fi

exit 0
