#!/usr/bin/env bash
# Remakes the README's screenshots, docs/screenshots/*.png, from the demo data only:
#   1. Builds the image, and starts it in a throwaway stack, test-kinship-shots, laid out
#      like test-kinship (tests/compose.test.yaml): its own database, no way out.
#   2. Runs the seed, then tests/screenshots/ in the `browser` service: four desktop pages
#      and two phone pages.
#   3. Shrinks each picture to at most 256 colours (sharp, in scripts/node.sh).
#
#   scripts/screenshots.sh
#
# Commit the pictures it writes after looking at them. Leaves no containers, networks,
# volumes, images or files behind, pass or fail.
set -euo pipefail
cd "$(dirname "$0")/.."

project=test-kinship-shots
KINSHIP_IMAGE=$project:app
STACK_RUNTIME=$(mktemp -d "${TMPDIR:-/tmp}/kinship-shots.XXXXXX")
chmod 700 "$STACK_RUNTIME"
HOST_UID=$(id -u)
HOST_GID=$(id -g)
export KINSHIP_IMAGE STACK_RUNTIME HOST_UID HOST_GID
compose=(docker compose -p "$project" --env-file "$STACK_RUNTIME/settings.env"
  -f compose.yaml -f tests/compose.test.yaml --profile tests)

step() { printf '\n==> %s\n' "$*"; }

password=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf 'POSTGRES_PASSWORD=%s\nKINSHIP_OWNER=demo\n' "$password" >"$STACK_RUNTIME/settings.env"
chmod 600 "$STACK_RUNTIME/settings.env"
mkdir -p "$STACK_RUNTIME/data/postgres"

if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]; then
  echo "A $project stack already exists; whoever started it has to remove it first." >&2
  rm -rf "$STACK_RUNTIME"
  exit 1
fi

cleanup() {
  local result=$?
  trap - EXIT
  set +e
  step "Removing the stack"
  "${compose[@]}" down --volumes --remove-orphans
  if ! rm -rf "$STACK_RUNTIME/data" 2>/dev/null; then
    docker run --rm --user 0:0 -v "$STACK_RUNTIME:/runtime" --entrypoint rm "$NODE_IMAGE" -rf /runtime/data
  fi
  rm -rf "$STACK_RUNTIME"
  docker image rm "$KINSHIP_IMAGE" >/dev/null 2>&1
  exit "$result"
}
NODE_IMAGE=$(sed -n 's/^NODE_IMAGE="\(.*\)"$/\1/p' scripts/node.sh)
trap cleanup EXIT

step "Building the image"
docker buildx build --progress=quiet --load -t "$KINSHIP_IMAGE" .

step "Starting the stack, with the demo seed"
"${compose[@]}" up -d --wait --wait-timeout 180 db migrate web
"${compose[@]}" run --rm -T --no-deps migrate npm run --silent db:seed | tail -n 1

step "Taking the screenshots"
mkdir -p docs/screenshots
"${compose[@]}" run --rm --no-deps browser \
  npx playwright test --config tests/screenshots/playwright.config.ts

step "Shrinking them"
scripts/node.sh node -e '
  const sharp = require("sharp")
  const { readdirSync, renameSync, statSync } = require("node:fs")
  ;(async () => {
    for (const name of readdirSync("docs/screenshots").filter((n) => n.endsWith(".png"))) {
      const file = `docs/screenshots/${name}`
      await sharp(file).png({ palette: true, colours: 256, compressionLevel: 9 }).toFile(`${file}.tmp`)
      renameSync(`${file}.tmp`, file)
      console.log(`${file}: ${Math.round(statSync(file).size / 1024)} KiB`)
    }
  })().catch((e) => { console.error(e); process.exit(1) })
'
