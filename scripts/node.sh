#!/usr/bin/env bash
# Runs a command in the pinned Node image with the repo mounted at /w.
# Node does not have to be installed on the host; every npm/npx call goes through
# here so the host, the checks and the Dockerfile all use the same Node.
#
#   scripts/node.sh npm ci
#   scripts/node.sh npx vitest run
#
# ⚠️ Keep NODE_IMAGE in step with the Dockerfile's NODE_IMAGE.
set -euo pipefail

NODE_IMAGE="node:24.21.0-alpine3.24"
repo="$(cd "$(dirname "$0")/.." && pwd)"

tty=()
[ -t 0 ] && [ -t 1 ] && tty=(-it)

# prisma.config.ts needs a database URL even for `prisma generate`. Unless one is
# set, pass the Dockerfile's build-time placeholder; nothing connects to it.
exec docker run --rm "${tty[@]}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_update_notifier=false -e NEXT_TELEMETRY_DISABLED=1 \
  -e DATABASE_URL="${DATABASE_URL:-postgresql://build:build@localhost:5432/build}" \
  -v "$repo":/w -w /w \
  "$NODE_IMAGE" "$@"
