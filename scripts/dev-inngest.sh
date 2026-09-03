#!/usr/bin/env bash
set -euo pipefail

: "${PORT:?PORT not set — run this script via portless}"
: "${PORTLESS_URL:?PORTLESS_URL not set — run this script via portless}"

# Peer Next.js app URL — strip the `inngest.` segment portless added to our hostname.
NEXT_URL="${PORTLESS_URL/inngest./}"

# Inngest dev binds four ports: HTTP (--port), connect gateway HTTP, and two
# internal gRPC ports. Derive all four from the portless-assigned $PORT so
# multiple worktrees can run simultaneously without collisions.
exec inngest dev \
  --port "$PORT" \
  --connect-gateway-port "$((PORT + 1))" \
  --connect-gateway-grpc-port "$((PORT + 2))" \
  --connect-executor-grpc-port "$((PORT + 3))" \
  -u "$NEXT_URL/api/inngest"
