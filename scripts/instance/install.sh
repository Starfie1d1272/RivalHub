#!/usr/bin/env bash
# Install a verified immutable instance package; never runs database migrations.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root on the instance host.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
helper="$script_dir/../standby/production-host.mjs"
root=/opt/rivalhub-instance
config=/etc/rivalhub-instance/instance.env
unit=/etc/systemd/system/rivalhub-instance.service
install -d -m 755 "$root/releases"
install -d -m 700 /etc/rivalhub-instance "$root/rollback"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another instance operation is active.' >&2; exit 1; }
staging=''
tls_helper=$(mktemp -d "$root/.tls.XXXXXXXX")
sed 's/from "\.\/supabase-ca"/from "\.\/supabase-ca.ts"/' "$script_dir/../../src/db/postgres-connection.ts" > "$tls_helper/postgres-connection.ts"
cp "$script_dir/../../src/db/supabase-ca.ts" "$tls_helper/supabase-ca.ts"
trap '[[ -z $staging ]] || rm -rf -- "$staging"; rm -rf -- "$tls_helper"' EXIT
check_identity() {
  local node=$1 tag=$2 commit=$3
  curl --fail --silent --max-time 5 http://127.0.0.1:3033/ >/dev/null &&
    curl --fail --silent --max-time 5 http://127.0.0.1:3033/api/system/release > "$root/last-release-check.json" &&
    "$node" "$helper" identity "$root/last-release-check.json" "$tag" "$commit" &&
    env -i "$node" --env-file="$config" "$root/current/scripts/instance/readiness.mjs" "$root/current"
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
  systemctl stop rivalhub-instance || return 2
  [[ -n $active ]] || return 1
  if [[ -n $active ]]; then
    [[ $active == releases/rivalhub-production-* && -f $config ]] || return 1
    env -i "$root/$active/runtime/node" --env-file="$config" \
      "$script_dir/../standby/production-quiescence.mjs" "$root/$active" "$tls_helper/postgres-connection.ts" || return 1
  fi
}
restore() {
  if [[ -n $previous ]]; then
    env -i PATH=/usr/bin:/bin "$root/$previous/runtime/node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" || return 1
  fi
  # Also drain a failed/new candidate before allowing the old writer to start.
  quiesce || return 1
  if [[ -n $previous ]]; then
    cp -p "$snapshot/instance.env" "$config" || return 1
    cp -p "$snapshot/service" "$unit" || return 1
    ln -sfn "$previous" "$root/current.rollback" || return 1
    mv -Tf "$root/current.rollback" "$root/current" || return 1
    systemctl daemon-reload && systemctl reset-failed rivalhub-instance && systemctl start rivalhub-instance || return 1
    wait_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" || return 1
  else
    rm -f "$root/current" || return 1
    if [[ -f $snapshot/instance.env ]]; then cp -p "$snapshot/instance.env" "$config" || return 1; else rm -f "$config" || return 1; fi
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
  [[ $# == 7 && $6 == --capability-evidence ]] || { echo 'Rollback requires controller capability evidence.' >&2; exit 1; }
  capability_evidence=$(realpath "$7")
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
  operator=$(cat "$snapshot/operator-commit")
  cmp -s "$capability_evidence" "$snapshot/capability-evidence.json" || { echo 'Rollback capability evidence differs from transaction.' >&2; exit 1; }
  cmp -s "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$script_dir/../standby/release-capability-gate.mjs" || exit 1
  cmp -s "$(dirname "$capability_evidence")/capability-contract.ts" "$script_dir/../release/capability-contract.ts" || exit 1
  current=$(readlink "$root/current")
  [[ $current == "$candidate" || $current == "$previous" ]] || { echo 'Current release changed; refusing stale rollback.' >&2; exit 1; }
  if [[ $current == "$candidate" ]]; then
    "$root/$current/runtime/node" "$helper" manifest "$root/$current/standby.json" "${current#releases/}" "$tag" "$sha" >/dev/null || exit 1
  else
    "$root/$current/runtime/node" "$helper" manifest "$root/$current/standby.json" "${current#releases/}" "$previous_tag" "$previous_sha" >/dev/null || exit 1
  fi
  env -i PATH=/usr/bin:/bin "$root/$current/runtime/node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" || { echo 'Rollback capability check failed.' >&2; exit 1; }
  restore || { echo "ROLLBACK FAILED: $snapshot" >&2; exit 1; }
  echo "Previous release restored: $previous_tag $previous_sha"
  exit 0
fi
[[ $# == 2 || ( $# == 9 && $3 == --release && $8 == --capability-evidence ) ]] || { echo 'Usage: install.sh MANIFEST INSTANCE_ENV [--release TAG SHA PREVIOUS_TAG PREVIOUS_SHA --capability-evidence FILE]' >&2; exit 1; }
archive=$(realpath "$1")
env_file=$(realpath "$2")
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
archive_sha=$(sha256sum "$archive" | cut -d ' ' -f 1)
[[ $archive == *.layers.json ]] || { echo 'A layered manifest is required.' >&2; exit 1; }
name=$(basename "$archive" .layers.json)
[[ $name =~ ^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}$ ]] || exit 1
bootstrap="$root/current/runtime/node"
if [[ ! -x $bootstrap ]]; then bootstrap=$(command -v node); fi
"$bootstrap" -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)'
read -r tag sha < <("$bootstrap" -e 'const m = require(process.argv[1]); if (m.environment !== "instance" || !/^v[0-9]+\.[0-9]+\.[0-9]+-[a-zA-Z0-9.-]+$/.test(m.releaseTag) || !/^[a-f0-9]{40}$/.test(m.sourceCommit)) process.exit(1); console.log(m.releaseTag, m.sourceCommit)' "$archive")
[[ -n $tag && -n $sha ]] || exit 1
previous_tag='' previous_sha=''
if [[ $# == 9 ]]; then
  [[ $tag == "$4" && $sha == "$5" ]] || { echo 'Candidate identity mismatch.' >&2; exit 1; }
  previous_tag=$6 previous_sha=$7 capability_evidence=$(realpath "$9")
fi
staging=$(mktemp -d "$root/releases/.staging.XXXXXXXX")
assembled_sha=$("$bootstrap" "$script_dir/../standby/layers.mjs" assemble "$archive" "$(dirname "$archive")" "$root/layers" "$staging" "$tag" "$sha")
[[ $assembled_sha == "$archive_sha" ]] || exit 1
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
  [[ $# == 9 ]] || { echo 'Existing instances require the release controller.' >&2; exit 1; }
  [[ $env_file == "$config" ]] || { echo 'An upgrade requires the installed instance environment.' >&2; exit 1; }
  [[ $previous == releases/rivalhub-production-* && -f $root/$previous/standby.json && -f $config && -f $unit ]] || { echo 'Previous rollback state incomplete.' >&2; exit 1; }
  if [[ -z $previous_tag ]]; then
    read -r previous_tag previous_sha < <("$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}")
  fi
  [[ -n $previous_tag && -n $previous_sha ]] || exit 1
  "$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}" "$previous_tag" "$previous_sha" >/dev/null || { echo 'Current host differs from frozen previous release.' >&2; exit 1; }
  check_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" || { echo 'Running instance identity or ledger differs from frozen previous release.' >&2; exit 1; }
  "$node" -e 'const fs = require("fs"); const a = JSON.parse(fs.readFileSync(process.argv[1])).migrations, b = JSON.parse(fs.readFileSync(process.argv[2])).migrations; if (!Array.isArray(a) || !a.length || !Array.isArray(b) || a.length !== b.length || a.some((m, i) => m.hash !== b[i]?.hash || m.when !== b[i]?.when)) process.exit(1)' "$root/$previous/standby.json" "$staging/standby.json" || { echo 'Migration-changing upgrades are not supported.' >&2; exit 1; }
  operator=$("$node" "$helper" operator "$staging/standby.json")
  cmp -s "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$script_dir/../standby/release-capability-gate.mjs" || exit 1
  cmp -s "$(dirname "$capability_evidence")/capability-contract.ts" "$script_dir/../release/capability-contract.ts" || exit 1
  env -i PATH=/usr/bin:/bin "$node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" || { echo 'Installation capability check failed.' >&2; exit 1; }
elif [[ -n $previous_tag ]]; then
  echo 'Release requires an existing instance.' >&2; exit 1
fi
[[ -f $script_dir/rivalhub-instance.service ]] || exit 1
snapshot=$(mktemp -d "$root/rollback/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
printf '%s\n' "$previous" > "$snapshot/previous-release"
printf '%s\n' "releases/$release_name" > "$snapshot/candidate-release"
printf '%s %s %s %s\n' "$tag" "$sha" "$previous_tag" "$previous_sha" > "$snapshot/identity"
if [[ -n $previous ]]; then
  printf '%s\n' "$operator" > "$snapshot/operator-commit"
  cp -p "$capability_evidence" "$snapshot/capability-evidence.json"
fi
[[ ! -f $config ]] || cp -p "$config" "$snapshot/instance.env"
[[ ! -f $unit ]] || cp -p "$unit" "$snapshot/service"
"$node" "$helper" environment "$env_file" "$snapshot/candidate.env" "$tag" "$sha"
env -i "$node" --env-file="$snapshot/candidate.env" "$staging/scripts/instance/validate-runtime.mjs" "$staging/standby.json"
if ! id rivalhub-instance >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin rivalhub-instance
fi
if [[ ! -e $release ]]; then
  printf '%s\n' "$archive_sha" > "$staging/.archive-sha256"
  mv "$staging" "$release"
  staging=''
fi
printf '%s\n' "$archive_sha" > "$release/.archive-sha256"
chmod -R o-rwx "$release"
chown -R root:rivalhub-instance "$release"
mkdir -p "$release/.next/cache" "$release/.next/server/route-cache"
chown -R rivalhub-instance:rivalhub-instance "$release/.next/cache" "$release/.next/server/route-cache"
# Persist recovery evidence before the first mutation, including interrupted SSH sessions.
printf '%s\n' "$snapshot" > "$root/previous-snapshot.next"
mv -Tf "$root/previous-snapshot.next" "$root/previous-snapshot"
# A failed drain must leave the current environment/pointer intact and the
# service stopped. Do not enter automatic restore until the drain succeeded.
if [[ -n $previous ]]; then
  env -i PATH=/usr/bin:/bin "$node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" || { echo 'Installation capability recheck failed.' >&2; exit 1; }
fi
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
install -m 644 "$script_dir/rivalhub-instance.service" "$unit"
ln -sfn "releases/$release_name" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl daemon-reload
systemctl reset-failed rivalhub-instance
systemctl restart rivalhub-instance
wait_identity "$release/runtime/node" "$tag" "$sha"
systemctl enable rivalhub-instance
trap - ERR HUP INT TERM
echo "Instance candidate active: $tag $sha; rollback snapshot: $snapshot"
