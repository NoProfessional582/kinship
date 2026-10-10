#!/usr/bin/env bash
# The app in a throwaway stack, test-kinship: its own Postgres, no published port, and an
# internal network that reaches nothing outside (tests/compose.test.yaml).
#   1. Builds the image and its builder stage once. The build prints no warnings, and the
#      app image holds only the standalone server, none of the source.
#   2. Starts db, migrate and web: migrate exits 0, db and web are healthy and never
#      restarted, and no service's logs hold an error.
#   3. The Vitest database suite (npm run test:integration), in the builder image.
#   4. The command-line jobs: the seed; an export; an import dry run, which changes
#      nothing; `import -- --replace`, which brings back the same data; and a LinkedIn
#      import of a made-up Connections.csv (tests/fixtures), twice.
#   5. Playwright (playwright.config.ts) in the `browser` service, then health and the logs
#      again. Startup and page logs stay strict; the final check allows exact test refusals.
#
#   scripts/test-stack.sh
#
# Settings are throwaway: a fresh database password and the owner `tester`, made per run
# in a private temporary folder that also holds the database and the uploads. Leaves no
# containers, networks, volumes, images or files behind, pass or fail; prints the stack's
# logs when anything fails. Needs Docker with Compose and Buildx; Node runs in the pinned
# image (scripts/node.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

project=test-kinship
app_image=test-kinship:app
builder_image=test-kinship:builder
STACK_RUNTIME=$(mktemp -d "${TMPDIR:-/tmp}/kinship-stack.XXXXXX")
chmod 700 "$STACK_RUNTIME"
HOST_UID=$(id -u)
HOST_GID=$(id -g)
export STACK_RUNTIME HOST_UID HOST_GID
# --env-file: the run's settings, never a .env in the checkout.
compose=(docker compose -p "$project" --env-file "$STACK_RUNTIME/settings.env"
  -f compose.yaml -f tests/compose.test.yaml --profile tests)

step() { printf '\n==> %s\n' "$*"; }

# Letters and digits only: compose.yaml puts the password into the database URL as-is.
password=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf 'POSTGRES_PASSWORD=%s\nKINSHIP_OWNER=tester\n' "$password" >"$STACK_RUNTIME/settings.env"
chmod 600 "$STACK_RUNTIME/settings.env"
mkdir -p "$STACK_RUNTIME/data/postgres" "$STACK_RUNTIME/data/uploads"

# Never claim an existing stack or its data: one test stack at a time. Any container of the
# project counts, whichever checkout or compose files started it.
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
  step "Removing the test stack"
  "${compose[@]}" down --volumes --remove-orphans
  # The database and uploads belong to the containers' users (postgres, root, uid 1001),
  # so a container removes them.
  if ! rm -rf "$STACK_RUNTIME/data" 2>/dev/null; then
    docker run --rm -v "$STACK_RUNTIME:/runtime" --entrypoint rm "$builder_image" -rf /runtime/data
  fi
  rm -rf "$STACK_RUNTIME"
  docker image rm "$app_image" "$builder_image" >/dev/null 2>&1
  exit "$result"
}
trap cleanup EXIT

# healthy: db and web running, healthy and never restarted; migrate exited 0.
healthy() {
  local service container state
  for service in db web; do
    container=$("${compose[@]}" ps -q "$service")
    state=$(docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' "$container")
    if [ "$state" != '0 healthy' ]; then
      echo "$service: restarts and health are '$state', not '0 healthy'" >&2
      return 1
    fi
  done
  container=$("${compose[@]}" ps -aq migrate)
  state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$container")
  if [ "$state" != 'exited 0' ]; then
    echo "migrate: '$state', not 'exited 0'" >&2
    return 1
  fi
  echo "db and web healthy, never restarted; migrate exited 0"
}

# check_logs LABEL [SINCE]: no line of any service's logs (since SINCE, if given) names an
# error. pg's DeprecationWarning ("client.query() when the client is already executing a
# query", from @prisma/adapter-pg) is known noise and matches none of the words: it is
# counted, not hidden. Only the final check passes --refusals to the checker.
check_logs() {
  local label=$1 since=${2:-} mode=${3:-} logs noise service
  for service in db migrate web; do
    logs=$("${compose[@]}" logs --no-color --no-log-prefix ${since:+--since "$since"} "$service")
    if ! awk -v service="$service" -v refusals="${mode:+1}" -f scripts/check-stack-logs.awk <<<"$logs"; then
      echo "Errors in $service logs ($label), above." >&2
      return 1
    fi
    noise=$(grep -c 'DeprecationWarning' <<<"$logs" || true)
    echo "$service logs clean ($label); known noise: $noise pg DeprecationWarning line(s)"
  done
}

# cli COMMAND...: a one-off command in the builder image, the stack's migrate service.
cli() { "${compose[@]}" run --rm -T --no-deps migrate "$@"; }

# sql QUERY: one query against the stack's database, unaligned.
sql() {
  "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -qtA -U kinship -d kinship -c "$1"
}

# same_data A B: two exports hold the same data (everything but the time of the export).
same_data() {
  cmp <(grep -v '^  "exportedAt": ' "$1") <(grep -v '^  "exportedAt": ' "$2")
}

playwright_version=$(sed -n 's/^ *"@playwright\/test": "\(.*\)",*$/\1/p' package.json)
if [ "$(sed -n 's/^ *"version": "\(.*\)",*$/\1/p' node_modules/@playwright/test/package.json 2>/dev/null)" != "$playwright_version" ]; then
  step "Installing node_modules for Playwright (npm ci)"
  scripts/node.sh npm ci --no-audit --no-fund
fi

step "Building the builder stage (fresh) and the app image"
# The builder stage is never taken from the cache, so Next's build runs, and prints its
# warnings, on every run; the app image then reuses it.
docker buildx build --progress=plain --load --no-cache-filter builder --target builder \
  -t "$builder_image" . 2>&1 | tee "$STACK_RUNTIME/build.log"
docker buildx build --progress=plain --load -t "$app_image" . 2>&1 | tee -a "$STACK_RUNTIME/build.log"

step "The build printed no warnings, and the app image holds only the standalone server"
grep -q 'Compiled successfully' "$STACK_RUNTIME/build.log"
if grep -nE '⚠|Turbopack build encountered' "$STACK_RUNTIME/build.log" >&2; then
  echo "Next's build printed warnings, above." >&2
  exit 1
fi
contents=$(docker run --rm --entrypoint ls "$app_image" -A /app | tr '\n' ' ')
if [ "$contents" != '.next node_modules package.json public server.js ' ]; then
  echo "/app holds: $contents" >&2
  echo "Expected only .next node_modules package.json public server.js: did the build trace the whole project?" >&2
  exit 1
fi
echo "no warnings; /app holds $contents"

step "Starting db, migrate and web"
"${compose[@]}" up -d --wait --wait-timeout 180 db migrate web
healthy
check_logs "after start-up"
startup_done=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)

step "Vitest database suite, in the builder image"
cli npm run --silent test:integration
# Two of its rollback tests make Postgres refuse a row on purpose, and Postgres logs each
# refusal as an ERROR (entries: an integer out of range; archive-import: a duplicate slug,
# twice). The last log check starts here, so it covers the CLI jobs and the browser tests.
suite_done=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)

step "CLI: the seed"
cli npm run --silent db:seed | tee "$STACK_RUNTIME/seed.log"
grep -q '^Seed complete:' "$STACK_RUNTIME/seed.log"

step "CLI: an export"
cli npm run --silent export >"$STACK_RUNTIME/archive.json"
grep -q '^  "format": "kb-archive",$' "$STACK_RUNTIME/archive.json"
test "$(sql 'SELECT count(*) FROM "Contact"')" -gt 0

step "CLI: an import dry run changes nothing"
cli npm run --silent import <"$STACK_RUNTIME/archive.json" 2>&1 | tee "$STACK_RUNTIME/dry-run.log"
grep -qF 'Nothing was changed.' "$STACK_RUNTIME/dry-run.log"
cli npm run --silent export >"$STACK_RUNTIME/after-dry-run.json"
same_data "$STACK_RUNTIME/archive.json" "$STACK_RUNTIME/after-dry-run.json"
echo "the database exports the same data as before"

step "CLI: import -- --replace brings back the same data"
cli npm run --silent import -- --replace <"$STACK_RUNTIME/archive.json" 2>&1 |
  tee "$STACK_RUNTIME/replace.log"
grep -qE '^Restored [1-9][0-9]* rows' "$STACK_RUNTIME/replace.log"
cli npm run --silent export >"$STACK_RUNTIME/after-replace.json"
same_data "$STACK_RUNTIME/archive.json" "$STACK_RUNTIME/after-replace.json"
echo "the database exports the same data as before"

step "CLI: LinkedIn import of a made-up Connections.csv, then again (nothing doubled)"
linkedin=(env LINKEDIN_CSV=/app/tests/fixtures/linkedin-connections.csv npm run --silent import:linkedin)
cli "${linkedin[@]}" | tee "$STACK_RUNTIME/linkedin.log"
grep -qF 'Imported 2 contacts · skipped 0 already present · ignored 1 rows with no name · 1 carried credentials' \
  "$STACK_RUNTIME/linkedin.log"
cli "${linkedin[@]}" | tee "$STACK_RUNTIME/linkedin-again.log"
grep -qF 'Imported 0 contacts · skipped 2 already present' "$STACK_RUNTIME/linkedin-again.log"
test "$(sql "SELECT string_agg(\"displayName\", ', ' ORDER BY \"displayName\") FROM \"Contact\"
  WHERE owner = 'tester' AND \"displayName\" IN ('Otto Pemberly', 'Wren Ashby')")" = 'Otto Pemberly, Wren Ashby'
test "$(sql "SELECT a.value FROM \"ContactAttribute\" a JOIN \"Contact\" c ON c.id = a.\"contactId\"
  WHERE c.\"displayName\" = 'Otto Pemberly' AND a.key = 'Credentials'")" = PMP
echo "both contacts are in, once each, with Otto's credentials split off"

step "Playwright: every page, on a desktop and on a phone"
# Page-sweep logs stay strict: run the pages before the deliberate API refusals.
"${compose[@]}" run --rm --no-deps browser npm run --silent test:e2e -- pages.spec.ts --project=desktop --project=phone
check_logs "after page sweep" "$suite_done"

step "CLI: the legacy fixture's import dry run changes nothing"
cli npm run --silent export >"$STACK_RUNTIME/before-legacy-dry-run.json"
cli npm run --silent import <tests/fixtures/archive-v1.json 2>&1 | tee "$STACK_RUNTIME/legacy-dry-run.log"
grep -qF 'Nothing was changed.' "$STACK_RUNTIME/legacy-dry-run.log"
cli npm run --silent export >"$STACK_RUNTIME/after-legacy-dry-run.json"
same_data "$STACK_RUNTIME/before-legacy-dry-run.json" "$STACK_RUNTIME/after-legacy-dry-run.json"

step "Playwright: API refusals, desktop and phone flows, archive last"
"${compose[@]}" run --rm --no-deps browser
healthy
check_logs "whole test run after strict start-up check" "$startup_done" refusals

failed=0
step "PASSED"
