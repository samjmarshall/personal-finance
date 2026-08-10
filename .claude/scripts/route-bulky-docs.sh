#!/bin/bash
# PreToolUse gate: keep bulky doc/library loads out of the MAIN session context.
#
# Wired (in .claude/settings.json) to two matchers:
#   - "Skill"            → gate only the claude-api skill (all other skills pass)
#   - context7 MCP tools → gate all Context7 lookups
#
# In a SUBAGENT (stdin carries .agent_id) we ALLOW: the whole point is that a
# delegated agent loads the docs and returns the distilled facts, so the bulky
# payload lands in the subagent's context, not ours. In the MAIN session we DENY
# with a redirect message that Claude Code feeds back to the model.
#
# Escape hatch for the user: invoke the skill/tool yourself via the `!` prefix in
# the prompt — hooks do not run on user-invoked actions.

INPUT=$(cat)

# Subagent? Allow — let the delegate do the bulky load.
if [ -n "$(printf '%s' "$INPUT" | jq -r '.agent_id // empty')" ]; then
  exit 0
fi

TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name')

deny() {  # $1 = reason shown to the model
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$TOOL" in
  Skill)
    SKILL=$(printf '%s' "$INPUT" | jq -r '.tool_input.skill // empty')
    case "$SKILL" in
      claude-api)
        deny "The '$SKILL' skill inlines ~55-75k tokens of bundled docs into the main context, most irrelevant to any one question and all permanent. Delegate it to the web-lookup subagent (Agent tool, which owns the '$SKILL' skill); it loads the skill and returns only the distilled facts you need (signatures, flags, the one client class). The gate ALLOWS the skill inside subagents — it only blocks the main session."
        ;;
    esac
    ;;
  mcp__context7__*)
    deny "Context7 lookups load full library docs into the main context. Run them inside the web-lookup subagent (Agent tool, which owns the Context7 tools) and return only the distilled answer. This still honours the global Context7-first rule — it just keeps the doc payload off the main context. The gate ALLOWS Context7 inside subagents — it only blocks the main session."
    ;;
esac

exit 0
