#!/usr/bin/env bash
# Runs every check before a merge and stops at the first failure.
# With part names, runs only those parts (scripts/check.sh --list names them); each part
# prints its time, and the run ends with every part's time and the total.
#
#   scripts/check.sh                 every part, in order
#   scripts/check.sh quick privacy   only those parts
#
# Runs from any checkout of the repo. Needs bash 4 or later, git, Docker with Compose and
# Buildx, and gitleaks on the host; Node runs in the pinned image (scripts/node.sh).
set -euo pipefail

cd "$(dirname "$0")/.."

PARTS=(quick privacy stack)
declare -A ABOUT=(
  [quick]="format, lint, types, unit tests, dependency audit, compose ports"
  [privacy]="secret scans and the personal-data sweep, on the files and this branch's commits"
  [stack]="image build, then a throwaway test stack: health, logs, database tests, CLI jobs, Playwright"
)

# The private list of what must never be published (names, emails, the home domain): one
# Perl regex per line, with (?i) in front where case doesn't matter; blank lines and lines
# starting with # are skipped. It stays outside the repo, because committing it would
# publish what it guards. KINSHIP_PRIVATE_PATTERNS=none skips the sweep.
PRIVATE_PATTERNS=${KINSHIP_PRIVATE_PATTERNS:-${XDG_CONFIG_HOME:-$HOME/.config}/kinship/private-patterns.txt}

step() { printf '\n==> %s\n' "$*"; }

duration() { printf '%d min %02d s' $(($1 / 60)) $(($1 % 60)); }

part_quick() {
  step "Shell scripts: syntax"
  local script
  for script in scripts/*.sh; do bash -n "$script"; done

  step "Node: scripts/node.sh uses the Dockerfile's image"
  local image_dockerfile image_script
  image_dockerfile=$(sed -n 's/^ARG NODE_IMAGE=//p' Dockerfile)
  image_script=$(sed -n 's/^NODE_IMAGE="\(.*\)"$/\1/p' scripts/node.sh)
  if [[ -z $image_dockerfile || $image_dockerfile != "$image_script" ]]; then
    echo "Dockerfile has '$image_dockerfile', scripts/node.sh has '$image_script'." >&2
    return 1
  fi
  echo "$image_dockerfile"

  step "Install from the lockfile (npm ci)"
  scripts/node.sh npm ci --no-audit --no-fund

  step "Prisma: schema valid, client generated"
  scripts/node.sh npx prisma validate
  scripts/node.sh npx prisma generate

  step "Format (Prettier)"
  scripts/node.sh npm run --silent format:check

  step "Lint (ESLint)"
  scripts/node.sh npm run --silent lint

  step "Type check (tsc)"
  scripts/node.sh npm run --silent typecheck

  step "Unit tests (Vitest)"
  scripts/node.sh npm run --silent test

  step "Dependency audit (npm audit, high and critical)"
  scripts/node.sh npm audit --audit-level=high

  step "Compose publishes ports on 127.0.0.1 only"
  # Kinship has no sign-in, so anything reachable beyond this computer is open to all.
  # Placeholder settings; --env-file /dev/null keeps a local .env out of it.
  local config
  config=$(POSTGRES_PASSWORD=placeholder KINSHIP_OWNER=placeholder \
    docker compose --env-file /dev/null -f compose.yaml config --format json)
  scripts/node.sh node -e '
    const bad = []
    for (const [name, service] of Object.entries(JSON.parse(process.argv[1]).services)) {
      if (service.network_mode === "host") bad.push(`${name}: uses the host network`)
      for (const port of service.ports ?? [])
        if (port.host_ip !== "127.0.0.1")
          bad.push(`${name}: ${port.host_ip || "every address"}:${port.published} -> ${port.target}`)
    }
    if (bad.length) {
      console.error(`Reachable from beyond 127.0.0.1:\n  ${bad.join("\n  ")}`)
      process.exit(1)
    }
    console.log("Every published port is on 127.0.0.1.")
  ' "$config"
}

part_privacy() {
  step "Secret scan: this branch's commits (gitleaks)"
  git fetch -q origin main
  gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .

  step "Secret scan: working tree, including files not yet added to git (gitleaks)"
  # gitleaks skips what .gitignore lists (node_modules, .env, data).
  gitleaks dir --no-banner --redact .

  step "Personal-data sweep: files, and this branch's commits (authors, messages, changes)"
  private_sweep
}

private_sweep() {
  if [[ $PRIVATE_PATTERNS == none ]]; then
    echo "Skipped: KINSHIP_PRIVATE_PATTERNS=none."
    return 0
  fi
  if [[ ! -r $PRIVATE_PATTERNS ]]; then
    echo "No pattern list at $PRIVATE_PATTERNS." >&2
    echo "Create one (README.md, Checks), or set KINSHIP_PRIVATE_PATTERNS=none to skip the sweep." >&2
    return 1
  fi
  if ! grep -q -v -e '^#' -e '^[[:space:]]*$' "$PRIVATE_PATTERNS"; then
    echo "$PRIVATE_PATTERNS lists no patterns." >&2
    return 1
  fi
  # Comments and blank lines become (?!), which never matches, so that git grep's line
  # numbers in an error about a pattern are the list's own.
  sed -e 's/^#.*$//' -e 's/^[[:space:]]*$/(?!)/' "$PRIVATE_PATTERNS" >"$tmp/patterns"

  # git grep exits 1 when nothing matches, and above 1 when it could not search.
  local found=0 status commits commit hits
  commits=$(git rev-list --reverse origin/main..HEAD)
  status=0
  git grep -nIP --untracked -f "$tmp/patterns" || status=$?
  case $status in
    0) found=1 ;;
    1) ;;
    *) return "$status" ;;
  esac

  for commit in $commits; do
    git show --no-color --format='Author: %an <%ae>%nCommitter: %cn <%ce>%n%n%B' "$commit" >"$tmp/commit"
    status=0
    hits=$(git -C "$tmp" grep --no-index -hnIP -f patterns -- commit) || status=$?
    case $status in
      0)
        found=1
        git log -1 --format='commit %h %s' "$commit"
        printf '%s\n' "$hits"
        ;;
      1) ;;
      *) return "$status" ;;
    esac
  done

  if ((found)); then
    echo "Personal data found (patterns from $PRIVATE_PATTERNS)." >&2
    return 1
  fi
  echo "Nothing found in the files or in this branch's $(wc -w <<<"$commits") commits."
}

part_stack() {
  # The image and the app running: scripts/test-stack.sh says what it covers, and removes
  # everything it made, pass or fail.
  scripts/test-stack.sh
}

usage() {
  echo "usage: scripts/check.sh [--list | PART...]   (no PART: every part, in order)" >&2
  exit 2
}

if [[ ${1:-} == --list ]]; then
  for part in "${PARTS[@]}"; do printf '%-12s %s\n' "$part" "${ABOUT[$part]}"; done
  exit 0
fi
if [[ $# -eq 0 ]]; then selected=("${PARTS[@]}"); else selected=("$@"); fi
for part in "${selected[@]}"; do
  if [[ -z ${ABOUT[$part]:-} ]]; then
    echo "unknown part: $part" >&2
    usage
  fi
done

tmp=$(mktemp -d)
declare -A took=()
current=""
part_began=$SECONDS
started=$SECONDS
report() {
  local status=$? part
  rm -rf "$tmp"
  printf '\n%-12s %s\n' "Part" "Time"
  for part in "${selected[@]}"; do
    if [[ -n ${took[$part]:-} ]]; then
      printf '%-12s %s\n' "$part" "$(duration "${took[$part]}")"
    elif [[ $part == "$current" ]]; then
      printf '%-12s %s (failed)\n' "$part" "$(duration $((SECONDS - part_began)))"
    fi
  done
  printf '%-12s %s\n' "Total" "$(duration $((SECONDS - started)))"
  if [[ $status -eq 0 ]]; then
    printf '\nAll checks passed: %s.\n' "${selected[*]}"
  else
    printf '\nFailed in part %s.\n' "${current:-?}"
  fi
}
trap report EXIT

for part in "${selected[@]}"; do
  current=$part
  part_began=$SECONDS
  printf '\n######## Part: %s (%s)\n' "$part" "${ABOUT[$part]}"
  "part_$part"
  took[$part]=$((SECONDS - part_began))
  printf '\n==> Part %s passed in %s\n' "$part" "$(duration "${took[$part]}")"
done
current=""
