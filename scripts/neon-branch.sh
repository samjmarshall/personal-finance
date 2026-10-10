#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# neon-branch.sh — Manage local Neon DB branches per git branch
#
# Usage:
#   scripts/neon-branch.sh create         Create/reuse branch, update .env, migrate
#   scripts/neon-branch.sh delete         Delete current branch's Neon DB branch and Blob files
#   scripts/neon-branch.sh delete --all   Delete all local/* Neon branches and Blob files
#   scripts/neon-branch.sh status         List all local/* branches
# ---------------------------------------------------------------------------

NEON_API="https://console.neon.tech/api/v2"
REPO_ROOT="$(git rev-parse --show-toplevel)"
ENV_FILE="$REPO_ROOT/.env"
PREFIX="local"

# ── Helpers ────────────────────────────────────────────────────────────────

log()  { echo "[neon-branch] $*"; }
err()  { echo "[neon-branch] ERROR: $*" >&2; }

# Cross-platform sed -i
sed_inplace() {
  if [[ "$OSTYPE" == darwin* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# Mask password in a postgresql:// URL for display
mask_url() {
  echo "$1" | sed -E 's|(://[^:]+:)[^@]+(@)|\1****\2|'
}

# ERE matching an assignment line for a variable, allowing leading whitespace
# and an `export ` prefix.
env_var_pattern() {
  printf '^[[:space:]]*(export[[:space:]]+)?%s=' "$1"
}

# Read a variable from .env.
# Handles an optional `export ` prefix, surrounding single/double quotes
# (needed when the value has special characters), and trailing CR.
# Last assignment wins, matching how dotenv resolves duplicate keys.
read_env_var() {
  local var="$1" line value
  [[ -f "$ENV_FILE" ]] || return 0

  line=$(grep -E "$(env_var_pattern "$var")" "$ENV_FILE" | tail -1) || return 0
  value="${line#*=}"
  value="${value%$'\r'}"

  if [[ ${#value} -ge 2 && "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\"/\"}"
  elif [[ ${#value} -ge 2 && "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

# Update or append a variable in .env
# Writes the value double-quoted so special characters survive; read_env_var
# strips the quotes back off. Uses awk to replace in-place, avoiding sed
# metacharacter issues with URLs.
update_env_var() {
  local var="$1" value="$2"
  local line_out="${var}=\"${value//\"/\\\"}\""

  if grep -Eq "$(env_var_pattern "$var")" "$ENV_FILE" 2>/dev/null; then
    local tmp="${ENV_FILE}.tmp"
    # Compare the key literally (index, not a regex) so a var name is never
    # interpreted as a pattern.
    awk -v key="$var" -v out="$line_out" '
      {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        sub(/^export[[:space:]]+/, "", line)
        if (index(line, key "=") == 1) { print out; next }
        print
      }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s\n' "$line_out" >> "$ENV_FILE"
  fi
}

# Neon API call. Returns body on stdout, exits on HTTP error.
# Usage: neon_api GET "/branches"
#        neon_api POST "/branches" '{"branch":{"name":"..."}}'
neon_api() {
  local method="$1" endpoint="$2" body="${3:-}"
  local url="${NEON_API}/projects/${NEON_PROJECT_ID}${endpoint}"
  local response http_code

  if [[ -n "$body" ]]; then
    response=$(curl -s -w '\n%{http_code}' \
      -X "$method" \
      -H "Authorization: Bearer $NEON_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "$url")
  else
    response=$(curl -s -w '\n%{http_code}' \
      -X "$method" \
      -H "Authorization: Bearer $NEON_API_KEY" \
      "$url")
  fi

  http_code=$(echo "$response" | tail -1)
  local body_out
  body_out=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 400 ]]; then
    local msg
    msg=$(echo "$body_out" | jq -r '.message // .error // "Unknown error"' 2>/dev/null || echo "$body_out")
    err "API $method $endpoint → HTTP $http_code: $msg"
    return 1
  fi

  echo "$body_out"
}

# Empty a Blob prefix (adr028). The caller runs it before the Neon delete: a
# failure aborts with the Neon branch still there, so a re-run retries both.
delete_branch_blobs() {
  local prefix="$1"
  local token="${BLOB_READ_WRITE_TOKEN:-$(read_env_var BLOB_READ_WRITE_TOKEN)}"

  if [[ -z "$token" ]]; then
    log "Skipping blob cleanup for $prefix — BLOB_READ_WRITE_TOKEN not set"
    return 0
  fi
  (cd "$REPO_ROOT" && BLOB_READ_WRITE_TOKEN="$token" node scripts/blob-prefix-delete.ts "$prefix")
}

# Resolve connection URIs for a branch ID, update .env
# The Blob prefix travels with the DB URL (adr028): a branch DB with an empty
# prefix would delete the production files its copied rows point at.
apply_branch_urls() {
  local branch_id="$1" blob_prefix="$2"

  local pooled_uri unpooled_uri
  pooled_uri=$(neon_api GET "/connection_uri?branch_id=${branch_id}&role_name=neondb_owner&database_name=neondb&pooled=true" | jq -r '.uri')
  unpooled_uri=$(neon_api GET "/connection_uri?branch_id=${branch_id}&role_name=neondb_owner&database_name=neondb&pooled=false" | jq -r '.uri')

  update_env_var "DATABASE_URL" "$pooled_uri"
  update_env_var "DATABASE_URL_UNPOOLED" "$unpooled_uri"
  update_env_var "BLOB_PATH_PREFIX" "$blob_prefix"
  log ".env updated — DATABASE_URL=$(mask_url "$pooled_uri") BLOB_PATH_PREFIX=\"$blob_prefix\""
}

# ── Load credentials ──────────────────────────────────────────────────────

load_credentials() {
  # Fall back to .env if not already in environment
  if [[ -z "${NEON_API_KEY:-}" ]]; then
    NEON_API_KEY=$(read_env_var NEON_API_KEY)
  fi
  if [[ -z "${NEON_PROJECT_ID:-}" ]]; then
    NEON_PROJECT_ID=$(read_env_var NEON_PROJECT_ID)
  fi

  if [[ -z "${NEON_API_KEY:-}" ]] || [[ -z "${NEON_PROJECT_ID:-}" ]]; then
    log "Skipping — NEON_API_KEY or NEON_PROJECT_ID not set"
    exit 0
  fi
}

# ── Commands ──────────────────────────────────────────────────────────────

cmd_create() {
  local git_branch
  git_branch=$(git branch --show-current)

  if [[ -z "$git_branch" ]]; then
    log "Detached HEAD — skipping"
    exit 0
  fi

  # On main/master: restore production URLs
  if [[ "$git_branch" == "main" ]] || [[ "$git_branch" == "master" ]]; then
    log "On $git_branch — switching to production DB"
    local branches primary_id
    branches=$(neon_api GET "/branches")
    primary_id=$(echo "$branches" | jq -r '.branches[] | select(.primary == true) | .id')
    if [[ -n "$primary_id" ]]; then
      apply_branch_urls "$primary_id" ""
    fi
    exit 0
  fi

  local neon_branch_name="${PREFIX}/${git_branch}"

  # Truncate to 128 chars (Neon limit)
  if [[ ${#neon_branch_name} -gt 128 ]]; then
    neon_branch_name="${neon_branch_name:0:128}"
    log "Warning: branch name truncated to 128 chars"
  fi

  # Check if branch already exists
  local branches branch_id
  branches=$(neon_api GET "/branches")
  branch_id=$(echo "$branches" | jq -r --arg name "$neon_branch_name" \
    '.branches[] | select(.name == $name) | .id')

  if [[ -z "$branch_id" ]]; then
    log "Creating branch: $neon_branch_name"
    local create_response
    create_response=$(neon_api POST "/branches" \
      "{\"branch\":{\"name\":\"${neon_branch_name}\"},\"endpoints\":[{\"type\":\"read_write\"}]}")
    branch_id=$(echo "$create_response" | jq -r '.branch.id')
    log "Created: $neon_branch_name ($branch_id)"
  else
    log "Exists: $neon_branch_name"
    # Ensure the branch has a compute endpoint (may be missing if created without one)
    local endpoints
    endpoints=$(neon_api GET "/branches/${branch_id}/endpoints")
    local endpoint_count
    endpoint_count=$(echo "$endpoints" | jq '.endpoints | length')
    if [[ "$endpoint_count" -eq 0 ]]; then
      log "Creating compute endpoint for existing branch..."
      neon_api POST "/endpoints" \
        "{\"endpoint\":{\"branch_id\":\"${branch_id}\",\"type\":\"read_write\"}}" > /dev/null
    fi
  fi

  # The full git branch, not the 128-char Neon name: Blob has no length limit
  # and teardown.yml deletes blobs by the full name.
  apply_branch_urls "$branch_id" "${PREFIX}/${git_branch}/"

  # Run migrations
  log "Running migrations..."
  (cd "$REPO_ROOT" && SKIP_ENV_VALIDATION=1 pnpm run db:migrate)
  log "Done — local dev is using branch: $neon_branch_name"
}

cmd_delete() {
  local delete_all=false
  if [[ "${1:-}" == "--all" ]]; then
    delete_all=true
  fi

  local branches
  branches=$(neon_api GET "/branches")

  if $delete_all; then
    delete_branch_blobs "${PREFIX}/"
    local ids
    ids=$(echo "$branches" | jq -r --arg prefix "${PREFIX}/" \
      '.branches[] | select(.name | startswith($prefix)) | .id')

    if [[ -z "$ids" ]]; then
      log "No ${PREFIX}/* branches found"
    else
      local count=0
      while IFS= read -r id; do
        local name
        name=$(echo "$branches" | jq -r --arg id "$id" '.branches[] | select(.id == $id) | .name')
        neon_api DELETE "/branches/${id}" > /dev/null
        log "Deleted: $name"
        count=$((count + 1))
      done <<< "$ids"
      log "Deleted $count branch(es)"
    fi
  else
    local git_branch
    git_branch=$(git branch --show-current)
    local neon_branch_name="${PREFIX}/${git_branch}"
    # Before the not-found exit: files can outlive a Neon branch deleted elsewhere.
    delete_branch_blobs "${PREFIX}/${git_branch}/"
    local branch_id
    branch_id=$(echo "$branches" | jq -r --arg name "$neon_branch_name" \
      '.branches[] | select(.name == $name) | .id')

    if [[ -z "$branch_id" ]]; then
      log "Branch not found: $neon_branch_name"
      exit 0
    fi

    neon_api DELETE "/branches/${branch_id}" > /dev/null
    log "Deleted: $neon_branch_name"
  fi

  # Restore production URLs
  local primary_id
  primary_id=$(echo "$branches" | jq -r '.branches[] | select(.primary == true) | .id')
  if [[ -n "$primary_id" ]]; then
    apply_branch_urls "$primary_id" ""
    log "Restored .env to production DB"
  fi
}

cmd_status() {
  local branches
  branches=$(neon_api GET "/branches")

  local git_branch
  git_branch=$(git branch --show-current)
  local current_neon="${PREFIX}/${git_branch}"

  local local_branches
  local_branches=$(echo "$branches" | jq -r --arg prefix "${PREFIX}/" \
    '.branches[] | select(.name | startswith($prefix)) | "\(.name)\t\(.created_at)"')

  if [[ -z "$local_branches" ]]; then
    log "No ${PREFIX}/* branches found"
  else
    echo ""
    echo "  Local Neon branches:"
    echo "  ─────────────────────────────────────────────"
    while IFS=$'\t' read -r name created; do
      local marker=" "
      if [[ "$name" == "$current_neon" ]]; then
        marker="*"
      fi
      printf "  %s %-50s %s\n" "$marker" "$name" "${created%T*}"
    done <<< "$local_branches"
    echo ""
  fi

  # Show current .env DATABASE_URL
  local current_url
  current_url=$(read_env_var DATABASE_URL)
  if [[ -n "$current_url" ]]; then
    log ".env DATABASE_URL=$(mask_url "$current_url")"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  err "jq is required but not installed. Install with: brew install jq"
  exit 1
fi

load_credentials

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  delete)  shift; cmd_delete "$@" ;;
  status)  cmd_status ;;
  *)
    echo "Usage: scripts/neon-branch.sh {create|delete|status}"
    echo "  create             Create/reuse Neon branch for current git branch and migrate"
    echo "  delete             Delete current branch's Neon branch and Blob files"
    echo "  delete --all       Delete all ${PREFIX}/* Neon branches and Blob files"
    echo "  status             List all ${PREFIX}/* Neon branches"
    exit 1
    ;;
esac
