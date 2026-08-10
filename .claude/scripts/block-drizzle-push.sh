#!/bin/bash
# Pre-tool hook for Claude Code. Reads the Bash tool invocation from stdin,
# extracts the command, and blocks it (exit 2) if it runs `drizzle-kit push`.
# `drizzle-kit push` applies schema changes directly without recording them in
# the migrations table, breaking idempotency. Use the two-step migration flow
# instead: `make db_generate` then `make db_migrate`.
#
# Escape hatch for the user: run the command directly via the `!` prefix in the
# Claude prompt — hooks do not run on user-invoked shell commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Extract only the first line (the actual shell command, not heredoc body)
FIRST_LINE=$(echo "$COMMAND" | head -1)

# Match `drizzle-kit push` regardless of prefix (yarn drizzle-kit push, npx, etc.)
if echo "$FIRST_LINE" | grep -qE 'drizzle-kit[[:space:]]+push'; then
  echo "BLOCKED: '$FIRST_LINE' uses 'drizzle-kit push', which applies schema changes without recording a migration — breaking idempotency. Use \`make db_generate\` then \`make db_migrate\` instead. The user has prevented this without explicit override." >&2
  exit 2
fi

exit 0
