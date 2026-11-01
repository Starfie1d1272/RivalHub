#!/usr/bin/env bash
# Install a verified immutable production package; never runs database migrations.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root on the verified production host.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
helper="$script_dir/production-host.mjs"
root=/opt/rivalhub-production
config=/etc/rivalhub-production/production.env
unit=/etc/systemd/system/rivalhub-production.service
install -d -m 755 "$root/releases"
install -d -m 700 /etc/rivalhub-production "$root/rollback"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another production operation is active.' >&2; exit 1; }
staging=''
trap '[[ -z $staging ]] || rm -rf -- "$staging"' EXIT
check_identity() {
  local node=$1 tag=$2 commit=$3
  curl --fail --silent --max-time 5 http://127.0.0.1:3032/ >/dev/null &&
    curl --fail --silent --max-time 5 http://127.0.0.1:3032/api/system/release > "$root/last-release-check.json" &&
    "$node" "$helper" identity "$root/last-release-check.json" "$tag" "$commit"
}
wait_identity() {
  local attempt
  for attempt in {1..15}; do
    if check_identity "$@"; then return 0; fi
    sleep 2
  done
  return 1
}
quiesce() {
  # After identity checks, stop admission (including HTTP cron) and drain pooler work.
  local active
  active=$(readlink "$root/current" || true)
  # First install has no previous writer or registered unit to stop.
  if [[ -z $active && ! -f $unit ]]; then return 0; fi
  systemctl stop rivalhub-production || return 2
  [[ -n $active ]] || return 1
  if [[ -n $active ]]; then
    [[ $active == releases/rivalhub-production-* && -f $config ]] || return 1
    env -i "$root/$active/runtime/node" --env-file="$config" \
      "$script_dir/production-quiescence.mjs" "$root/$active" "$script_dir/postgres-connection.ts" || return 1
  fi
}
restore() {
  # Also drain a failed/new candidate before allowing the old writer to start.
  quiesce || return 1
  if [[ -n $previous ]]; then
    cp -p "$snapshot/production.env" "$config" || return 1
    cp -p "$snapshot/service" "$unit" || return 1
    ln -sfn "$previous" "$root/current.rollback" || return 1
    mv -Tf "$root/current.rollback" "$root/current" || return 1
    systemctl daemon-reload && systemctl reset-failed rivalhub-production && systemctl start rivalhub-production || return 1
    wait_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" || return 1
  else
    rm -f "$root/current" || return 1
    if [[ -f $snapshot/production.env ]]; then cp -p "$snapshot/production.env" "$config" || return 1; else rm -f "$config" || return 1; fi
    if [[ -f $snapshot/service ]]; then cp -p "$snapshot/service" "$unit" || return 1; else rm -f "$unit" || return 1; fi
    systemctl daemon-reload || return 1
  fi
}
failed() {
  trap - ERR HUP INT TERM
  if restore; then echo "Candidate failed; previous state restored: $snapshot" >&2
  else echo "ROLLBACK FAILED; manual recovery required: $snapshot" >&2; fi
  exit 1
}
if [[ ${1:-} == --rollback ]]; then
  [[ $# == 5 ]] || { echo 'Usage: --rollback TAG SHA PREVIOUS_TAG PREVIOUS_SHA' >&2; exit 1; }
  # A failed preflight has no matching transaction to restore.
  snapshot=$(cat "$root/previous-snapshot" 2>/dev/null || true)
  if [[ ! -f $snapshot/identity || $(cat "$snapshot/identity") != "$2 $3 $4 $5" ]]; then
    current=$(readlink "$root/current")
    [[ $current == releases/rivalhub-production-* ]] || exit 1
    env -i "$root/$current/runtime/node" --env-file="$config" "$helper" runtime-identity "$4" "$5"
    check_identity "$root/$current/runtime/node" "$4" "$5"
    echo 'Previous release remains healthy; no matching transaction to restore.'
    exit 0
  fi
  [[ $snapshot == "$root/rollback/"* && -d $snapshot ]] || exit 1
  read -r tag sha previous_tag previous_sha < "$snapshot/identity"
  [[ "$tag $sha $previous_tag $previous_sha" == "$2 $3 $4 $5" ]] || { echo 'Rollback identity mismatch.' >&2; exit 1; }
  previous=$(cat "$snapshot/previous-release")
  candidate=$(cat "$snapshot/candidate-release")
  current=$(readlink "$root/current")
  [[ $current == "$candidate" || $current == "$previous" ]] || { echo 'Current release changed; refusing stale rollback.' >&2; exit 1; }
  restore || { echo "ROLLBACK FAILED: $snapshot" >&2; exit 1; }
  echo "Previous release restored: $previous_tag $previous_sha"
  exit 0
fi
archive=$(realpath "${1:?Usage: install-production.sh ARCHIVE PRODUCTION_ENV [--release TAG SHA PREVIOUS_TAG PREVIOUS_SHA]}")
env_file=$(realpath "${2:?Production environment file required}")
tag='' sha='' previous_tag='' previous_sha=''
if [[ $# != 2 ]]; then
  [[ $# == 7 && $3 == --release ]] || exit 1
  tag=$4 sha=$5 previous_tag=$6 previous_sha=$7
  [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && $sha =~ ^[a-f0-9]{40}$ && $previous_tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ && $previous_sha =~ ^[a-f0-9]{40}$ ]] || exit 1
  [[ $env_file == "$config" ]] || { echo 'Release requires the installed production environment.' >&2; exit 1; }
fi
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
archive_sha=$(sha256sum "$archive" | cut -d ' ' -f 1)
staging=$(mktemp -d "$root/releases/.staging.XXXXXXXX")
if [[ $archive == *.layers.json ]]; then
  name=$(basename "$archive" .layers.json)
  [[ $name =~ ^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}$ && -n $tag && -n $sha ]] || exit 1
  # Layered updates bootstrap with the installed runtime; first installation retains the whole-tar path.
  bootstrap="$root/current/runtime/node"
  [[ -x $bootstrap ]] || { echo 'Layered update requires an existing runtime.' >&2; exit 1; }
  assembled_sha=$("$bootstrap" "$script_dir/layers.mjs" assemble "$archive" "$(dirname "$archive")" "$root/layers" "$staging" "$tag" "$sha")
  [[ $assembled_sha == "$archive_sha" ]] || exit 1
else
  name=$(basename "$archive" .tar.gz)
  [[ $name =~ ^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}$ ]] || exit 1
  tar -xzf "$archive" -C "$staging" --no-same-owner
fi
release_name="$name-${archive_sha:0:12}"
release="$root/releases/$release_name"
node="$staging/runtime/node"
read -r tag sha < <("$node" "$helper" manifest "$staging/standby.json" "$name" "$tag" "$sha")
[[ -n $tag && -n $sha ]] || exit 1
if [[ -e $release ]]; then
  [[ ( ! -f $release/.archive-sha256 || $(cat "$release/.archive-sha256") == "$archive_sha" ) && $("$node" "$helper" tree "$release") == $("$node" "$helper" tree "$staging") ]] || { echo 'Existing release differs from verified archive.' >&2; exit 1; }
fi
previous=$(readlink "$root/current" || true)
if [[ -n $previous ]]; then
  [[ $previous == releases/rivalhub-production-* && -f $root/$previous/standby.json && -f $config && -f $unit ]] || { echo 'Previous rollback state incomplete.' >&2; exit 1; }
  if [[ -z $previous_tag ]]; then
    read -r previous_tag previous_sha < <("$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}")
  fi
  [[ -n $previous_tag && -n $previous_sha ]] || exit 1
  "$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}" "$previous_tag" "$previous_sha" >/dev/null || { echo 'Current host differs from frozen previous release.' >&2; exit 1; }
elif [[ -n $previous_tag ]]; then
  echo 'Release requires an existing production instance.' >&2; exit 1
fi
[[ -f $script_dir/rivalhub-production.service ]] || exit 1
snapshot=$(mktemp -d "$root/rollback/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
printf '%s\n' "$previous" > "$snapshot/previous-release"
printf '%s\n' "releases/$release_name" > "$snapshot/candidate-release"
printf '%s %s %s %s\n' "$tag" "$sha" "$previous_tag" "$previous_sha" > "$snapshot/identity"
[[ ! -f $config ]] || cp -p "$config" "$snapshot/production.env"
[[ ! -f $unit ]] || cp -p "$unit" "$snapshot/service"
"$node" "$helper" environment "$env_file" "$snapshot/candidate.env" "$tag" "$sha"
env -i "$node" --env-file="$snapshot/candidate.env" --input-type=module - "$staging" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { assertProductionStandbyEnvironment } = await import(pathToFileURL(`${root}/scripts/standby/start-production.mjs`));
assertProductionStandbyEnvironment(JSON.parse(readFileSync(`${root}/standby.json`, 'utf8')));
JS
if ! id rivalhub-production >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin rivalhub-production
fi
if [[ ! -e $release ]]; then
  printf '%s\n' "$archive_sha" > "$staging/.archive-sha256"
  mv "$staging" "$release"
  staging=''
fi
printf '%s\n' "$archive_sha" > "$release/.archive-sha256"
chmod -R o-rwx "$release"
chown -R root:rivalhub-production "$release"
mkdir -p "$release/.next/cache" "$release/.next/server/route-cache"
chown -R rivalhub-production:rivalhub-production "$release/.next/cache" "$release/.next/server/route-cache"
# Persist recovery evidence before the first mutation, including interrupted SSH sessions.
printf '%s\n' "$snapshot" > "$root/previous-snapshot.next"
mv -Tf "$root/previous-snapshot.next" "$root/previous-snapshot"
# A failed drain must leave the current environment/pointer intact and the
# service stopped. Do not enter automatic restore until the drain succeeded.
if quiesce; then
  :
else
  result=$?
  if [[ $result == 2 ]]; then
    echo 'Service stop not confirmed; service state is unknown, release unchanged.' >&2
  else
    echo 'Writer drain failed after service stop; release unchanged.' >&2
  fi
  exit 1
fi
trap failed ERR HUP INT TERM
install -m 600 "$snapshot/candidate.env" "$config"
install -m 644 "$script_dir/rivalhub-production.service" "$unit"
ln -sfn "releases/$release_name" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl daemon-reload
systemctl reset-failed rivalhub-production
systemctl restart rivalhub-production
wait_identity "$release/runtime/node" "$tag" "$sha"
systemctl enable rivalhub-production
trap - ERR HUP INT TERM
echo "Production candidate active: $tag $sha; rollback snapshot: $snapshot"
