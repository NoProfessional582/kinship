#!/usr/bin/env bash
# Upgrading a database made by the previous version keeps its data (code.md 25), in a
# throwaway stack, test-kinship-upgrade, laid out like test-kinship (tests/compose.test.yaml):
#   1. Builds the previous version (from `git archive`) and this one: the image of each, and
#      the previous version's builder stage, which ran its migrate before 0.1.0.
#   2. Starts the previous version on a fresh database: migrate, the seed, and one avatar
#      uploaded as a new contact's photo.
#   3. Records the rows in every table and the avatar's sha256.
#   4. Stops the previous web, runs this version's migrate (it must exit 0, and it says
#      what it applied), and starts this version's web.
#   5. Checks that every table holds as many rows as before, that /uploads serves the same
#      avatar bytes, that its contact still points at it, and that every desktop page loads
#      clean (tests/e2e/pages.spec.ts). The db and web logs must show no errors.
#
#   scripts/test-upgrade.sh          from the previous version (below) to this checkout
#   scripts/test-upgrade.sh REF      from REF instead (a tag, branch or commit)
#
# The previous version is the newest vX.Y.Z tag reachable from HEAD, or origin/main while
# there is none. Each version runs under its own compose.yaml and tests/compose.test.yaml
# (db, migrate, web, browser), in the same project and on the same data. The previous one
# finds its images in KINSHIP_BUILDER_IMAGE and KINSHIP_APP_IMAGE (before 0.1.0: migrate ran
# the builder stage) or KINSHIP_IMAGE (0.1.0 on: one image).
#
# Leaves no containers, networks, volumes, images or files behind, pass or fail; prints the
# stack's logs when anything fails. Needs git and Docker with Compose and Buildx; Node runs
# in the pinned image (scripts/node.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

project=test-kinship-upgrade
images=("$project:old-builder" "$project:old-app" "$project:app")
STACK_RUNTIME=$(mktemp -d "${TMPDIR:-/tmp}/kinship-upgrade.XXXXXX")
chmod 700 "$STACK_RUNTIME"
HOST_UID=$(id -u)
HOST_GID=$(id -g)
export STACK_RUNTIME HOST_UID HOST_GID
compose=(docker compose -p "$project" --env-file "$STACK_RUNTIME/settings.env"
  -f compose.yaml -f tests/compose.test.yaml --profile tests)
# The previous version's own files; its build contexts are reset, so they are never used.
old_compose=(docker compose -p "$project" --env-file "$STACK_RUNTIME/settings.env"
  -f "$STACK_RUNTIME/previous/compose.yaml" -f "$STACK_RUNTIME/previous/tests/compose.test.yaml"
  --profile tests)

step() { printf '\n==> %s\n' "$*"; }

# The previous version's images, under every name its test overlay may read.
export KINSHIP_BUILDER_IMAGE="$project:old-builder" KINSHIP_APP_IMAGE="$project:old-app"
export KINSHIP_IMAGE="$project:old-app"

if [ $# -gt 0 ]; then
  previous=$1
elif previous=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null); then
  :
else
  git fetch -q origin main
  previous=origin/main
fi
previous_commit=$(git rev-parse --short "$previous^{commit}")

# Letters and digits only: compose.yaml puts the password into the database URL as-is.
password=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf 'POSTGRES_PASSWORD=%s\nKINSHIP_OWNER=tester\n' "$password" >"$STACK_RUNTIME/settings.env"
chmod 600 "$STACK_RUNTIME/settings.env"
mkdir -p "$STACK_RUNTIME/data/postgres" "$STACK_RUNTIME/data/uploads" "$STACK_RUNTIME/previous"

# Never claim an existing stack or its data: one upgrade check at a time.
if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]; then
  echo "A $project stack already exists; whoever started it has to remove it first." >&2
  rm -rf "$STACK_RUNTIME"
  exit 1
fi

failed=1
cleanup() {
  local result=$?
  trap - EXIT
  set +e
  if [ "$failed" -ne 0 ]; then
    step "FAILED: the stack's logs"
    "${compose[@]}" logs --no-color --timestamps
  fi
  step "Removing the upgrade stack"
  "${compose[@]}" down --volumes --remove-orphans
  # The database and uploads belong to the containers' users, so a container removes them.
  if ! rm -rf "$STACK_RUNTIME/data" 2>/dev/null; then
    docker run --rm -v "$STACK_RUNTIME:/runtime" --entrypoint rm "$NODE_IMAGE" -rf /runtime/data
  fi
  rm -rf "$STACK_RUNTIME"
  docker image rm "${images[@]}" >/dev/null 2>&1
  exit "$result"
}
NODE_IMAGE=$(sed -n 's/^NODE_IMAGE="\(.*\)"$/\1/p' scripts/node.sh)
trap cleanup EXIT

# web_healthy: web running, healthy and never restarted.
web_healthy() {
  local state
  state=$(docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' "$("${compose[@]}" ps -q web)")
  if [ "$state" != '0 healthy' ]; then
    echo "web: restarts and health are '$state', not '0 healthy'" >&2
    return 1
  fi
}

# sql QUERY: one query against the stack's database, unaligned.
sql() {
  "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -qtA -U kinship -d kinship -c "$1"
}

# row_counts: "table rows" for every table but Prisma's own migration list.
row_counts() {
  sql "SELECT table_name || ' ' || (xpath('/row/n/text()', query_to_xml(
         format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'
       ORDER BY table_name"
}

# in_web SCRIPT [ARG...]: Node in the running web container, against the app itself.
in_web() { "${compose[@]}" exec -T web node -e "$@"; }

playwright_version=$(sed -n 's/^ *"@playwright\/test": "\(.*\)",*$/\1/p' package.json)
if [ "$(sed -n 's/^ *"version": "\(.*\)",*$/\1/p' node_modules/@playwright/test/package.json 2>/dev/null)" != "$playwright_version" ]; then
  step "Installing node_modules for Playwright (npm ci)"
  scripts/node.sh npm ci --no-audit --no-fund
fi

step "Building the previous version, $previous ($previous_commit), and this checkout"
git archive "$previous_commit" | tar -x -C "$STACK_RUNTIME/previous"
docker buildx build --progress=quiet --load --target builder -t "$project:old-builder" "$STACK_RUNTIME/previous"
docker buildx build --progress=quiet --load -t "$project:old-app" "$STACK_RUNTIME/previous"
docker buildx build --progress=quiet --load -t "$project:app" .
echo "built ${images[*]}"

step "Previous version: db, migrate and web"
"${old_compose[@]}" up -d --wait --wait-timeout 180 db migrate web
web_healthy

step "Previous version: the seed, and a contact with an uploaded photo"
"${old_compose[@]}" run --rm -T --no-deps migrate npm run --silent db:seed | tail -n 1
# A real 1×1 PNG, as in tests/support/files.ts.
avatar_contact='Upgrade Photo'
avatar=$(in_web '
  const png = Buffer.from(process.argv[1], "base64")
  const form = new FormData()
  form.append("file", new Blob([png], { type: "image/png" }), "avatar.png")
  const base = "http://127.0.0.1:3000"
  const ok = async (r) => { if (!r.ok) throw new Error(`${r.url}: ${r.status} ${await r.text()}`); return r.json() }
  ;(async () => {
    const { url } = await ok(await fetch(`${base}/api/upload`, { method: "POST", body: form }))
    await ok(await fetch(`${base}/api/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: process.argv[2], avatarUrl: url }),
    }))
    console.log(url)
  })().catch((e) => { console.error(e); process.exit(1) })
' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' "$avatar_contact")
echo "$avatar_contact's photo is $avatar"

# avatar_sha256: the avatar as /uploads serves it.
avatar_sha256() {
  in_web '
    fetch("http://127.0.0.1:3000" + process.argv[1]).then(async (r) => {
      if (!r.ok) throw new Error(`${r.url}: ${r.status}`)
      const bytes = Buffer.from(await r.arrayBuffer())
      console.log(require("node:crypto").createHash("sha256").update(bytes).digest("hex"))
    }).catch((e) => { console.error(e); process.exit(1) })
  ' "$avatar"
}

step "Previous version: what the database and the uploads hold"
row_counts | tee "$STACK_RUNTIME/rows-before"
avatar_before=$(avatar_sha256)
echo "avatar sha256 $avatar_before"
if ! grep -qv ' 0$' "$STACK_RUNTIME/rows-before"; then
  echo "Every table is empty: the seed made nothing to keep." >&2
  exit 1
fi

step "This version: migrate, with the previous web stopped"
"${old_compose[@]}" stop web
export KINSHIP_IMAGE="$project:app"
"${compose[@]}" run --rm -T --no-deps migrate 2>&1 | tee "$STACK_RUNTIME/migrate.log"
grep -qE 'No pending migrations to apply|migrations? (have|has) been applied' "$STACK_RUNTIME/migrate.log"

step "This version: web"
"${compose[@]}" up -d --wait --wait-timeout 180 --no-deps web
web_healthy
"${compose[@]}" images web | tail -n 1

step "Every table holds the same number of rows"
row_counts >"$STACK_RUNTIME/rows-after"
if ! diff "$STACK_RUNTIME/rows-before" "$STACK_RUNTIME/rows-after"; then
  echo "Rows per table changed in the upgrade (< before, > after)." >&2
  exit 1
fi
echo "$(wc -l <"$STACK_RUNTIME/rows-after") tables, the same counts"

step "The avatar is still served, byte for byte, and still $avatar_contact's photo"
test "$(avatar_sha256)" = "$avatar_before"
test "$(sql "SELECT \"avatarUrl\" FROM \"Contact\" WHERE \"displayName\" = '$avatar_contact'")" = "$avatar"
echo "same sha256, same photo"

step "Playwright: every desktop page, on the upgraded data"
"${compose[@]}" run --rm --no-deps browser npm run --silent test:e2e -- pages.spec.ts --project=desktop
web_healthy
for service in db web; do
  logs=$("${compose[@]}" logs --no-color --no-log-prefix "$service")
  if ! awk -v service="$service" -f scripts/check-stack-logs.awk <<<"$logs"; then
    echo "Errors in the $service logs, above." >&2
    exit 1
  fi
done
echo "db and web logs clean"

failed=0
step "PASSED: $previous ($previous_commit) to this checkout"
