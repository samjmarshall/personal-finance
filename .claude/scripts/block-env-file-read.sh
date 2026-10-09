#!/bin/bash
# Pre-tool hook for Claude Code. Blocks Bash tool calls that would expose .env
# file contents. Reads the tool invocation from stdin as JSON. Read tool calls
# are blocked by the `Read(...)` deny rules in .claude/settings.json.
#
# .env files hold secrets — use `make env_pull` to sync env vars from Vercel.
# Escape hatch for the user: run commands directly via the `!` prefix in the
# Claude prompt — hooks do not run on user-invoked shell commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Check each line for a .env filename appearing as a path token.
# Matches: cat .env, head /app/.env.local, grep SECRET .env.production
# Does not match: NODE_ENV=, process.env.FOO, cat .envrc, cat .environment
ENV_PATTERN='(^|[[:space:]]|/|"|'"'"')\.env(\.[a-zA-Z0-9_.-]+)?([[:space:]]|$|[";'"'"'|&>])'
# The git-tracked template .env.example holds no secrets; drop it before matching.
EXAMPLE_PATTERN='(^|[[:space:]]|/|"|'"'"')\.env\.example([[:space:]]|$|[";'"'"'|&>])'
while IFS= read -r line; do
  line=$(echo "$line" | sed -E "s#$EXAMPLE_PATTERN#\1\2#g")
  if echo "$line" | grep -qE "$ENV_PATTERN"; then
    echo "BLOCKED: The command references a .env file — .env files may contain secrets. Use \`make env_pull\` to sync env vars from Vercel." >&2
    exit 2
  fi
done <<< "$COMMAND"

exit 0
