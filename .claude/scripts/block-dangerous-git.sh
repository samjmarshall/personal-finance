#!/bin/bash
# Pre-tool hook for Claude Code. Reads the Bash tool invocation from stdin,
# extracts the command, and blocks it (exit 2) if it matches a destructive
# git pattern. Claude receives the stderr message as refusal context.
#
# Escape hatch for the user: run the command directly via the `!` prefix
# in the Claude prompt — hooks do not run on user-invoked shell commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Extract only the first line (the actual shell command, not heredoc body)
FIRST_LINE=$(echo "$COMMAND" | head -1)

# Block force pushes on any branch. --force matches both --force and --force-with-lease.
if echo "$FIRST_LINE" | grep -qE 'git[[:space:]]+push.*(--force|[[:space:]]-f([[:space:]]|$))'; then
  echo "BLOCKED: '$FIRST_LINE' is a force push. The user has prevented this without explicit override." >&2
  exit 2
fi

# Block pushes that target main / master. Matches 'origin main', 'origin master',
# 'HEAD:main', 'dev:master', etc. Does not match 'maintenance', 'feature/main', or
# 'main:dev' (pushing FROM main is allowed; only pushing TO main/master is blocked).
if echo "$FIRST_LINE" | grep -qE 'git[[:space:]]+push.*([[:space:]]|:)(main|master)([[:space:]]|$)'; then
  echo "BLOCKED: '$FIRST_LINE' targets the protected main/master branch. The user has prevented this without explicit override." >&2
  exit 2
fi

# Other destructive patterns (push patterns handled above).
DANGEROUS_PATTERNS=(
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \\."
  "git restore \\."
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$FIRST_LINE" | grep -qE "$pattern"; then
    echo "BLOCKED: '$FIRST_LINE' matches dangerous pattern '$pattern'. The user has prevented you from doing this without explicit override." >&2
    exit 2
  fi
done

# reset --hard checked separately against first line to avoid matching heredoc body
if echo "$FIRST_LINE" | grep -qE "reset[[:space:]]+--hard"; then
  echo "BLOCKED: '$FIRST_LINE' matches dangerous pattern 'reset --hard'. The user has prevented you from doing this without explicit override." >&2
  exit 2
fi

exit 0
