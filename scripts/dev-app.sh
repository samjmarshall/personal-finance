#!/usr/bin/env bash
set -euo pipefail

: "${PORTLESS_URL:?PORTLESS_URL not set — run this script via portless}"

# Peer Inngest dev server lives at the same hostname with `inngest.` inserted
# before `personal-finance.localhost`. Holds for the main worktree and any
# branch-prefixed linked worktree (portless adds the prefix to both names
# symmetrically).
export INNGEST_BASE_URL="${PORTLESS_URL/personal-finance.localhost/inngest.personal-finance.localhost}"

# Put the SDK in dev mode. Without this the SDK defaults to cloud mode and
# rejects the dev server's sync (PUT /api/inngest 500: "no signing key found").
# INNGEST_BASE_URL only overrides the URL — it does not flip the mode.
export INNGEST_DEV=1

# Tell the SDK which origin to report to the dev server at sync time. Without
# this, the SDK derives the URL from `NextRequest.url` (https://localhost:$PORT)
# or the forwarded Host header — both of which portless rewrites to the internal
# `localhost:$PORT`, so the dev server calls back over HTTPS to a plain-HTTP port
# and the TLS handshake fails ("server gave HTTP response to HTTPS client").
# INNGEST_SERVE_ORIGIN overrides unconditionally via reqUrl(), so the dev server
# always invokes steps through the portless URL.
export INNGEST_SERVE_ORIGIN="$PORTLESS_URL"

exec next dev --turbo
