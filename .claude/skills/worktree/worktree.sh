#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# worktree.sh — Manage per-issue git worktrees with isolated Neon branches
#               and portless dev URLs.
#
# Usage:
#   worktree.sh create <issue#> [--slug <override>] [--dry-run]
#   worktree.sh list
#   worktree.sh cleanup <issue#|branch> [--force] [--dry-run]
#   worktree.sh cleanup --merged [--dry-run]
#
# Each worktree lives at .worktrees/<issue#>-<slug>. The directory name is a
# DNS-safe label so portless can use it as a hostname prefix
# (<issue#>-<slug>.personal-finance.localhost) and neon-branch.sh keys its branch off it
# (local/<issue#>-<slug>). The Neon branch lifecycle is owned by the
# post-checkout hook (create) and teardown.yml (delete) — this script never
# calls the Neon API directly.
# ---------------------------------------------------------------------------

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREES_DIR="$REPO_ROOT/.worktrees"
BASE_BRANCH="main"
DEV_HOST_SUFFIX="personal-finance.localhost"
MAX_SLUG_LEN=60

# ── Helpers ────────────────────────────────────────────────────────────────

log() { echo "[worktree] $*"; }
err() { echo "[worktree] ERROR: $*" >&2; }

# Reduce arbitrary text to a DNS-safe label: lowercase, [^a-z0-9-]->-, collapse
# repeats, trim leading/trailing hyphens, truncate.
slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/-+/-/g; s/^-+//; s/-+$//' \
    | cut -c "1-${MAX_SLUG_LEN}" \
    | sed -E 's/-+$//'
}

# Fail unless invoked from the main worktree. In a linked worktree the git-dir
# and the common git-dir differ; in the main worktree they are the same.
assert_main_worktree() {
  local git_dir common_dir
  git_dir="$(git rev-parse --absolute-git-dir)"
  common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
  if [[ "$git_dir" != "$common_dir" ]]; then
    err "run from the main worktree (the repo root), not a linked worktree."
    exit 1
  fi
}

portless_url() { echo "https://${1}.${DEV_HOST_SUFFIX}"; }
neon_name()    { echo "local/${1}"; }
worktree_dir() { echo "$WORKTREES_DIR/${1}"; }

# Resolve a branch name for an issue number. Uses the issue title for the slug;
# falls back to issue-<N> if gh is unavailable or the issue is not found.
resolve_branch_for_issue() {
  local issue="$1" override="${2:-}"
  if [[ -n "$override" ]]; then
    echo "${issue}-$(slugify "$override")"
    return
  fi
  local title=""
  if command -v gh &>/dev/null; then
    title="$(gh issue view "$issue" --json title --jq .title 2>/dev/null || true)"
  fi
  if [[ -z "$title" ]]; then
    err "could not resolve issue #${issue} title (gh missing or issue not found) — using issue-${issue}"
    echo "issue-${issue}"
    return
  fi
  echo "${issue}-$(slugify "$title")"
}

branch_exists()   { git show-ref --quiet --verify "refs/heads/$1"; }
worktree_exists() { [[ -d "$(worktree_dir "$1")" ]]; }

# ── create ──────────────────────────────────────────────────────────────────

cmd_create() {
  local issue="" slug_override="" dry_run=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug)    slug_override="$2"; shift 2 ;;
      --dry-run) dry_run=true; shift ;;
      -*)        err "unknown option: $1"; exit 1 ;;
      *)         issue="$1"; shift ;;
    esac
  done

  if [[ -z "$issue" ]]; then
    err "issue number required: worktree.sh create <issue#>"
    exit 1
  fi

  assert_main_worktree

  local branch wt neon url
  branch="$(resolve_branch_for_issue "$issue" "$slug_override")"
  wt="$(worktree_dir "$branch")"
  neon="$(neon_name "$branch")"
  url="$(portless_url "$branch")"

  if $dry_run; then
    log "DRY RUN — would create:"
    log "  branch:   $branch"
    log "  worktree: $wt"
    log "  neon:     $neon"
    log "  dev url:  $url"
    return
  fi

  # Idempotent reuse: an existing worktree just gets reopened by the caller.
  if worktree_exists "$branch"; then
    log "Worktree already exists: $wt — reusing"
    echo "WORKTREE_DIR=$wt"
    echo "BRANCH=$branch"
    echo "DEV_URL=$url"
    return
  fi

  # Secrets must exist before checkout, or the post-checkout hook no-ops on
  # missing NEON_API_KEY and the Neon branch is never provisioned.
  if [[ ! -f "$REPO_ROOT/.env" ]]; then
    err "$REPO_ROOT/.env not found — run 'make env_pull' first."
    exit 1
  fi

  # Create the worktree without populating it, so the post-checkout hook does
  # not fire before .env is in place.
  if branch_exists "$branch"; then
    log "Branch exists — adding worktree on $branch"
    git worktree add --no-checkout "$wt" "$branch"
  else
    log "Creating worktree + branch $branch"
    git worktree add --no-checkout "$wt" -b "$branch"
  fi

  cp "$REPO_ROOT/.env" "$wt/.env"
  # thoughts/ is gitignored, so the checkout does not bring it across — copy it
  # in explicitly. (.claude/, .mcp.json, CLAUDE.md are tracked and arrive via
  # checkout.)
  [[ -d "$REPO_ROOT/thoughts" ]] && cp -r "$REPO_ROOT/thoughts/." "$wt/thoughts/"
  log "Copied .env + thoughts/ into worktree"

  # Populate the tree. This fires post-checkout ($3=1) with .env present, so
  # scripts/neon-branch.sh create provisions local/<branch>, migrates, seeds.
  log "Checking out — provisioning Neon branch $neon via post-checkout hook…"
  if ! git -C "$wt" checkout "$branch"; then
    err "checkout/Neon provisioning failed. The worktree exists at $wt; fix the"
    err "issue and re-run 'scripts/neon-branch.sh create' from inside it."
    exit 1
  fi

  if [[ ! -d "$wt/node_modules" ]]; then
    log "Installing dependencies…"
    (cd "$wt" && yarn install --frozen-lockfile)
  fi

  log "Ready."
  echo "WORKTREE_DIR=$wt"
  echo "BRANCH=$branch"
  echo "DEV_URL=$url"
}

# ── cleanup ──────────────────────────────────────────────────────────────────

# Resolve a target (issue number or branch/dir name) to a branch with an
# existing worktree. An issue number maps to the newest .worktrees/<N>-* match.
resolve_target_branch() {
  local target="$1"
  if [[ -d "$(worktree_dir "$target")" ]]; then
    echo "$target"
    return
  fi
  if [[ "$target" =~ ^[0-9]+$ ]]; then
    local match
    match="$(ls -1dt "$WORKTREES_DIR/${target}-"* 2>/dev/null | head -1 || true)"
    if [[ -n "$match" ]]; then
      basename "$match"
      return
    fi
  fi
  return 1
}

# Print the reason a worktree is unsafe to remove, or nothing if it is clean.
unsafe_reason() {
  local wt="$1"
  if [[ -n "$(git -C "$wt" status --porcelain)" ]]; then
    echo "uncommitted changes"
    return
  fi
  local unpushed
  if git -C "$wt" rev-parse '@{u}' &>/dev/null; then
    unpushed="$(git -C "$wt" log --oneline '@{u}..HEAD' 2>/dev/null || true)"
  else
    unpushed="$(git -C "$wt" log --oneline "${BASE_BRANCH}..HEAD" 2>/dev/null || true)"
  fi
  [[ -n "$unpushed" ]] && echo "unpushed commits" || true
}

# Remove one worktree + its local branch. Honors force/dry_run; applies the
# safety guard unless forced. Returns: 0 removed, 1 skipped.
remove_worktree() {
  local branch="$1" force="$2" dry_run="$3"
  local wt; wt="$(worktree_dir "$branch")"

  local reason; reason="$(unsafe_reason "$wt")"
  if [[ -n "$reason" ]] && ! $force; then
    log "SKIP $branch — $reason (use --force to override)"
    return 1
  fi

  if $dry_run; then
    log "DRY RUN — would remove worktree $wt and branch $branch"
    return 0
  fi

  # Release the portless host for this worktree (best-effort).
  (cd "$REPO_ROOT" && yarn run portless prune >/dev/null 2>&1) || true

  if $force; then
    git worktree remove --force "$wt"
    git branch -D "$branch" 2>/dev/null || true
  else
    git worktree remove "$wt"
    git branch -d "$branch" 2>/dev/null || true
  fi
  log "Removed $branch (Neon branch $(neon_name "$branch") is reaped by teardown.yml on branch delete)"
  return 0
}

cmd_cleanup() {
  local target="" force=false dry_run=false merged=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --merged)  merged=true; shift ;;
      --force)   force=true; shift ;;
      --dry-run) dry_run=true; shift ;;
      -*)        err "unknown option: $1"; exit 1 ;;
      *)         target="$1"; shift ;;
    esac
  done

  assert_main_worktree

  if $merged; then
    [[ -d "$WORKTREES_DIR" ]] || { log "No worktrees."; return; }
    local removed=0 skipped=0 b
    for dir in "$WORKTREES_DIR"/*/; do
      [[ -d "$dir" ]] || continue
      b="$(basename "$dir")"
      local is_merged=false
      if git branch --merged "$BASE_BRANCH" 2>/dev/null | grep -qx "  $b"; then
        is_merged=true
      elif command -v gh &>/dev/null \
        && [[ -n "$(gh pr list --head "$b" --state merged --json number --jq '.[0].number' 2>/dev/null || true)" ]]; then
        is_merged=true
      fi
      $is_merged || continue
      if remove_worktree "$b" "$force" "$dry_run"; then
        removed=$((removed + 1))
      else
        skipped=$((skipped + 1))
      fi
    done
    log "Sweep done — removed $removed, skipped $skipped"
    return
  fi

  if [[ -z "$target" ]]; then
    err "target required: worktree.sh cleanup <issue#|branch> [--force] | --merged"
    exit 1
  fi

  local branch
  if ! branch="$(resolve_target_branch "$target")"; then
    err "no worktree found for '$target'"
    exit 1
  fi
  remove_worktree "$branch" "$force" "$dry_run"
}

# ── list ──────────────────────────────────────────────────────────────────────

cmd_list() {
  if [[ ! -d "$WORKTREES_DIR" ]] || [[ -z "$(ls -A "$WORKTREES_DIR" 2>/dev/null)" ]]; then
    log "No worktrees."
    return
  fi

  printf "%-34s %-7s %-9s %s\n" "BRANCH" "STATE" "AHEAD/BEH" "DEV URL"
  printf "%-34s %-7s %-9s %s\n" "──────" "─────" "─────────" "───────"
  local b wt state ab ahead behind pr
  for dir in "$WORKTREES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    b="$(basename "$dir")"
    wt="$dir"
    if [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]]; then
      state="dirty"
    else
      state="clean"
    fi
    ahead="$(git -C "$wt" rev-list --count "${BASE_BRANCH}..HEAD" 2>/dev/null || echo 0)"
    behind="$(git -C "$wt" rev-list --count "HEAD..${BASE_BRANCH}" 2>/dev/null || echo 0)"
    ab="+${ahead}/-${behind}"
    printf "%-34s %-7s %-9s %s\n" "$b" "$state" "$ab" "$(portless_url "$b")"
  done
}

# ── main ──────────────────────────────────────────────────────────────────────

usage() {
  cat <<'EOF'
Usage:
  worktree.sh create <issue#> [--slug <override>] [--dry-run]
  worktree.sh list
  worktree.sh cleanup <issue#|branch> [--force] [--dry-run]
  worktree.sh cleanup --merged [--dry-run]
EOF
}

case "${1:-}" in
  create)  shift; cmd_create "$@" ;;
  list)    shift; cmd_list "$@" ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  -h|--help|"") usage ;;
  *)       err "unknown command: $1"; usage; exit 1 ;;
esac
