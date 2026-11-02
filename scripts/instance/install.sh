#!/usr/bin/env bash
# Install a verified immutable instance package under the release controller lock.
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
transition_arg=()
tls_helper=$(mktemp -d "$root/.tls.XXXXXXXX")
sed 's/from "\.\/supabase-ca"/from "\.\/supabase-ca.ts"/' "$script_dir/../../src/db/postgres-connection.ts" > "$tls_helper/postgres-connection.ts"
cp "$script_dir/../../src/db/supabase-ca.ts" "$tls_helper/supabase-ca.ts"
trap '[[ -z $staging ]] || rm -rf -- "$staging"; rm -rf -- "$tls_helper"' EXIT
check_identity() {
  local node=$1 tag=$2 commit=$3 environment=${4:-$config} database
  database=$(env -i "$node" --env-file="$environment" "$script_dir/database-identity.mjs") || return 1
  curl --fail --silent --max-time 5 http://127.0.0.1:3033/ >/dev/null &&
    curl --fail --silent --max-time 5 http://127.0.0.1:3033/api/system/release > "$root/last-release-check.json" &&
    "$node" "$helper" identity "$root/last-release-check.json" "$tag" "$commit" &&
    curl --fail --silent --max-time 5 http://127.0.0.1:3033/api/system/recovery-source > "$tls_helper/running-source.json" &&
    "$node" -e 'const fs = require("fs"); const r = JSON.parse(fs.readFileSync(process.argv[1])), d = JSON.parse(process.argv[2]); if (Object.keys(r).sort().join(",") !== "databaseName,releaseCommit,releaseTag,supabaseUrl" || r.releaseTag !== process.argv[3] || r.releaseCommit !== process.argv[4] || r.supabaseUrl !== `https://${d.project}.supabase.co` || r.databaseName !== d.database) process.exit(1)' "$tls_helper/running-source.json" "$database" "$tag" "$commit" &&
    env -i "$node" --env-file="$environment" "$root/current/scripts/instance/readiness.mjs" "$root/current"
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
  if [[ -f $snapshot/migration-started ]]; then
    echo "Database migration started; keep service stopped and restore the checkpoint before recovery: $snapshot" >&2
    quiesce || true
    return 1
  fi
  if [[ -n $previous ]]; then
    env -i PATH=/usr/bin:/bin "$root/$previous/runtime/node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" "${transition_arg[@]}" || return 1
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
  rm -f "$snapshot/checkpoint.env"
  if restore; then echo "Candidate failed; previous state restored: $snapshot" >&2
  else echo "ROLLBACK FAILED; manual recovery required: $snapshot" >&2; fi
  exit 1
}
if [[ ${1:-} == --restore-pair ]]; then
  [[ $# == 3 ]] || { echo 'Restore-pair requires verified full recovery evidence and restored target environment.' >&2; exit 1; }
  snapshot=$(realpath "$(cat "$root/previous-snapshot")")
  [[ $snapshot == "$root/rollback/"* && -f $snapshot/migration-started && -f $snapshot/full-checkpoint.json && -f $snapshot/identity ]] || { echo 'No major transaction requiring paired recovery.' >&2; exit 1; }
  read -r tag sha previous_tag previous_sha < "$snapshot/identity"
  previous=$(cat "$snapshot/previous-release")
  candidate=$(cat "$snapshot/candidate-release")
  current=$(readlink "$root/current")
  [[ $previous == releases/rivalhub-production-* && ( $current == "$candidate" || $current == "$previous" ) && -f $root/$previous/standby.json ]] || { echo 'Transaction release pointers differ.' >&2; exit 1; }
  [[ -f $2 && ! -L $2 && $(stat -c %u "$2") == 0 && $((8#$(stat -c %a "$2") & 077)) == 0 && $(stat -c %u "$(dirname "$2")") == 0 && $((8#$(stat -c %a "$(dirname "$2")") & 077)) == 0 ]] || { echo 'Protected recovery evidence required.' >&2; exit 1; }
  node="$root/$previous/runtime/node"
  "$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}" "$previous_tag" "$previous_sha" >/dev/null
  "$node" -e 'const fs = require("fs"), crypto = require("crypto"); const r = JSON.parse(fs.readFileSync(process.argv[1])), e = JSON.parse(fs.readFileSync(process.argv[2])); if (r.sourceManifestSha256 !== crypto.createHash("sha256").update(fs.readFileSync(process.argv[3])).digest("hex") || r.version !== 1 || e.artifactKind !== "full" || e.runId !== r.runId || e.artifactSha256 !== r.artifactSha256 || e.manifestSha256 !== r.manifestSha256 || e.source?.deployedReleaseTag !== r.source?.deployedReleaseTag || e.source?.deployedCommit !== r.source?.deployedCommit) process.exit(1)' "$snapshot/full-checkpoint.json" "$2" "$root/$previous/standby.json"
  quiesce || { echo 'Cannot drain current instance; paired recovery remains stopped.' >&2; exit 1; }
  "$node" "$helper" environment "$3" "$snapshot/restored-instance.env" "$previous_tag" "$previous_sha"
  env -i "$node" --env-file="$snapshot/restored-instance.env" "$script_dir/recovery-evidence.mjs" "$2" "$root/$previous/standby.json" "$previous_tag" "$previous_sha"
  env -i "$node" --env-file="$snapshot/restored-instance.env" "$root/$previous/scripts/instance/validate-runtime.mjs" "$root/$previous/standby.json"
  env -i "$node" --env-file="$snapshot/restored-instance.env" "$root/$previous/scripts/instance/readiness.mjs" "$root/$previous"
  install -m 600 "$snapshot/restored-instance.env" "$config"
  cp -p "$snapshot/service" "$unit"
  ln -sfn "$previous" "$root/current.recovery"
  mv -Tf "$root/current.recovery" "$root/current"
  systemctl daemon-reload && systemctl reset-failed rivalhub-instance && systemctl start rivalhub-instance && wait_identity "$node" "$previous_tag" "$previous_sha" || { systemctl stop rivalhub-instance || true; echo 'Paired recovery failed; service stopped.' >&2; exit 1; }
  echo "Verified paired recovery active: $previous_tag $previous_sha"
  exit 0
fi
if [[ ${1:-} == --rollback ]]; then
  [[ $# == 7 && $6 == --capability-evidence ]] || { echo 'Rollback requires controller capability evidence.' >&2; exit 1; }
  capability_evidence=$(realpath "$7")
  if "$root/current/runtime/node" -e 'const e = require(process.argv[1]); process.exit(e.version === 2 && e.transition === "instance-v2-to-v3" ? 0 : 1)' "$capability_evidence"; then transition_arg=(instance-v2-to-v3); fi
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
  env -i PATH=/usr/bin:/bin "$root/$current/runtime/node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" "${transition_arg[@]}" || { echo 'Rollback capability check failed.' >&2; exit 1; }
  restore || { echo "ROLLBACK FAILED: $snapshot" >&2; exit 1; }
  echo "Previous release restored: $previous_tag $previous_sha"
  exit 0
fi
[[ $# == 2 || ( $# == 9 && $3 == --release && $8 == --capability-evidence ) || ( $# == 11 && $3 == --release && $8 == --capability-evidence && ( ${10:-} == --recovery-evidence || ${10:-} == --checkpoint-env ) ) || ( $# == 12 && $3 == --release && $8 == --capability-evidence && ${10:-} == --checkpoint-env && ${12:-} == --major-transition ) ]] || { echo 'Use the instance release controller for upgrade or recovery.' >&2; exit 1; }
recovery_evidence='' checkpoint_env='' migration_changed=0
if [[ $# == 12 ]]; then transition_arg=(instance-v2-to-v3); fi
if [[ $# == 11 && ${10:-} == --recovery-evidence ]]; then recovery_evidence=${11:-}; fi
if [[ ( $# == 11 || $# == 12 ) && ${10:-} == --checkpoint-env ]]; then
  [[ ! -L ${11:-} ]] || { echo 'Checkpoint environment must not be a symlink.' >&2; exit 1; }
  checkpoint_env=$(realpath "${11:-}")
fi
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
if [[ $# == 9 || $# == 11 || $# == 12 ]]; then
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
  [[ $# == 9 || ( ( $# == 11 || $# == 12 ) && -n $checkpoint_env ) ]] || { echo 'Existing instances require the release controller.' >&2; exit 1; }
  [[ ! $env_file -ef $config ]] || { echo 'An upgrade requires a separate candidate environment; preserve the installed configuration.' >&2; exit 1; }
  [[ $previous == releases/rivalhub-production-* && -f $root/$previous/standby.json && -f $config && -f $unit ]] || { echo 'Previous rollback state incomplete.' >&2; exit 1; }
  if [[ -z $previous_tag ]]; then
    read -r previous_tag previous_sha < <("$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}")
  fi
  [[ -n $previous_tag && -n $previous_sha ]] || exit 1
  "$node" "$helper" manifest "$root/$previous/standby.json" "${previous#releases/}" "$previous_tag" "$previous_sha" >/dev/null || { echo 'Current host differs from frozen previous release.' >&2; exit 1; }
  check_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" || { echo 'Running instance identity or ledger differs from frozen previous release.' >&2; exit 1; }
  if ! "$node" -e 'const fs = require("fs"); const a = JSON.parse(fs.readFileSync(process.argv[1])).migrations, b = JSON.parse(fs.readFileSync(process.argv[2])).migrations; if (!Array.isArray(a) || !a.length || !Array.isArray(b) || a.length !== b.length || a.some((m, i) => m.hash !== b[i]?.hash || m.when !== b[i]?.when)) process.exit(1)' "$root/$previous/standby.json" "$staging/standby.json"; then
    migration_changed=1
    [[ -n $checkpoint_env && -f $checkpoint_env && ! -L $checkpoint_env && $(stat -c %u "$checkpoint_env") == 0 && $((8#$(stat -c %a "$checkpoint_env") & 077)) == 0 && $(stat -c %u "$(dirname "$checkpoint_env")") == 0 && $((8#$(stat -c %a "$(dirname "$checkpoint_env")") & 077)) == 0 ]] || { echo 'Migration requires a root-owned private checkpoint environment.' >&2; exit 1; }
  fi
  if [[ ${#transition_arg[@]} -gt 0 ]]; then
    [[ $migration_changed == 1 ]] || { echo 'Major transition requires a changed migration lineage.' >&2; exit 1; }
    "$node" -e 'const fs = require("fs"), crypto = require("crypto"); const read = p => JSON.parse(fs.readFileSync(p)); const chain = p => read(`${p}/meta/_journal.json`).entries.map(x => ({hash: crypto.createHash("sha256").update(fs.readFileSync(`${p}/${x.tag}.sql`)).digest("hex"), when:x.when})); const before = read(process.argv[1]).migrations, after = read(process.argv[2]).migrations, legacy = chain("drizzle/v2-migrations"), active = chain("drizzle/migrations"); const prefix = (a,b) => Array.isArray(a) && a.length > 0 && a.length <= b.length && a.every((x,i) => x.hash === b[i].hash && x.when === b[i].when); if (!prefix(before,legacy) || !prefix(after,active) || after.length !== active.length) process.exit(1)' "$root/$previous/standby.json" "$staging/standby.json" || { echo 'Major transition source or target lineage differs.' >&2; exit 1; }
  fi
  operator=$("$node" "$helper" operator "$staging/standby.json")
  cmp -s "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$script_dir/../standby/release-capability-gate.mjs" || exit 1
  cmp -s "$(dirname "$capability_evidence")/capability-contract.ts" "$script_dir/../release/capability-contract.ts" || exit 1
  env -i PATH=/usr/bin:/bin "$node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" "${transition_arg[@]}" || { echo 'Installation capability check failed.' >&2; exit 1; }
elif [[ -n $previous_tag ]]; then
  [[ $# == 11 && -n $recovery_evidence ]] || { echo 'Release requires an existing instance or verified recovery.' >&2; exit 1; }
  operator=$("$node" "$helper" operator "$staging/standby.json")
  cmp -s "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$script_dir/../standby/release-capability-gate.mjs" || exit 1
  cmp -s "$(dirname "$capability_evidence")/capability-contract.ts" "$script_dir/../release/capability-contract.ts" || exit 1
  env -i PATH=/usr/bin:/bin "$node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" "${transition_arg[@]}" || { echo 'Recovery capability check failed.' >&2; exit 1; }
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
if [[ -n $previous ]]; then
  check_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" "$snapshot/instance.env" || { echo 'Running instance does not match the preserved configuration.' >&2; exit 1; }
fi
"$node" "$helper" environment "$env_file" "$snapshot/candidate.env" "$tag" "$sha"
env -i "$node" --env-file="$snapshot/candidate.env" "$staging/scripts/instance/validate-runtime.mjs" "$staging/standby.json"
candidate_db=$(env -i "$node" --env-file="$snapshot/candidate.env" "$script_dir/database-identity.mjs")
if [[ -n $previous ]]; then
  [[ -z $recovery_evidence ]] || { echo 'Recovery evidence is only valid for a host without a previous release.' >&2; exit 1; }
  # Credentials and direct/pooler mode may change; project and database may not.
  previous_db=$(env -i "$node" --env-file="$snapshot/instance.env" "$script_dir/database-identity.mjs")
  [[ $previous_db == "$candidate_db" ]] || { echo 'Instance database destination changed; refusing upgrade.' >&2; exit 1; }
fi
# Check real provisioning facts before starting or switching the service. Only
# a first install requires the generic fresh-chain email rule to be absent.
readiness_args=()
if [[ -z $previous ]]; then
  if [[ -n $recovery_evidence ]]; then
    cp -pP -- "$recovery_evidence" "$snapshot/recovery-evidence.json"
    env -i "$node" --env-file="$snapshot/candidate.env" "$script_dir/recovery-evidence.mjs" "$snapshot/recovery-evidence.json" "$staging/standby.json" "$previous_tag" "$previous_sha"
  else
    readiness_args+=(--fresh)
  fi
fi
if [[ $migration_changed == 0 ]]; then
  env -i "$node" --env-file="$snapshot/candidate.env" "$staging/scripts/instance/readiness.mjs" "$staging" "${readiness_args[@]}"
fi
if ! id rivalhub-instance >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin rivalhub-instance
fi
if [[ ! -e $release ]]; then
  printf '%s\n' "$archive_sha" > "$staging/.archive-sha256"
  mv "$staging" "$release"
  staging=''
fi
node="$release/runtime/node"
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
if [[ -n $previous || -n $recovery_evidence ]]; then
  env -i PATH=/usr/bin:/bin "$node" "$(dirname "$capability_evidence")/release-capability-gate.mjs" "$capability_evidence" "$previous_tag" "$previous_sha" "$tag" "$sha" "$operator" "${transition_arg[@]}" || { echo 'Installation capability recheck failed.' >&2; exit 1; }
fi
if [[ -n $previous ]]; then
  cmp -s "$config" "$snapshot/instance.env" && check_identity "$root/$previous/runtime/node" "$previous_tag" "$previous_sha" "$snapshot/instance.env" || { echo 'Running instance or installed configuration changed before drain.' >&2; exit 1; }
  cp "$tls_helper/running-source.json" "$snapshot/running-source.json"
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
if [[ $migration_changed == 1 ]]; then
  # Recheck the exact source ledger after writers stop and after the checkpoint.
  env -i "$node" --env-file="$snapshot/instance.env" "$root/$previous/scripts/instance/readiness.mjs" "$root/$previous"
  cp -p "$checkpoint_env" "$snapshot/checkpoint.env"
  tool_path="$(dirname "$(command -v pnpm)"):$release/runtime:/usr/local/bin:/usr/bin:/bin"
  if [[ ${#transition_arg[@]} -gt 0 ]]; then
    env -i PATH="$tool_path" RIVALHUB_BACKUP_SOURCE=instance RIVALHUB_BACKUP_CLASS=pre-release "$node" --env-file="$snapshot/checkpoint.env" --env-file="$snapshot/instance.env" node_modules/tsx/dist/cli.mjs scripts/db/recovery/backup.ts --stopped-instance-source "$snapshot/running-source.json" --source-manifest "$root/$previous/standby.json" | tee "$snapshot/checkpoint.log"
    "$node" -e 'const fs = require("fs"), crypto = require("crypto"); const r = JSON.parse(fs.readFileSync(process.argv[1])), m = fs.readFileSync(process.argv[2]), source = JSON.parse(m), d = JSON.parse(process.argv[3]); const hash = crypto.createHash("sha256").update(m).digest("hex"), sha = /^[a-f0-9]{64}$/; if (r.version !== 1 || r.candidate?.tag !== process.argv[4] || r.candidate?.commit !== process.argv[5] || r.source?.deployedReleaseTag !== process.argv[6] || r.source?.deployedCommit !== process.argv[7] || r.sourceManifestSha256 !== hash || r.target?.supabaseUrl !== `https://${d.project}.supabase.co` || r.target?.databaseName !== d.database || !sha.test(r.artifactSha256 ?? "") || !sha.test(r.manifestSha256 ?? "") || !sha.test(r.storage?.inventorySha256 ?? "") || !sha.test(r.storage?.bucketInventorySha256 ?? "") || !r.completionKey || r.source?.migrationLineage !== "v2" || !Array.isArray(r.source?.v2MigrationLedger) || r.source.v2MigrationLedger.length !== source.migrations.length || r.source.v2MigrationLedger.some((x,i) => x.hash !== source.migrations[i].hash || x.when !== source.migrations[i].when)) process.exit(1)' "$snapshot/full-checkpoint.json" "$root/$previous/standby.json" "$candidate_db" "$tag" "$sha" "$previous_tag" "$previous_sha"
  else
    env -i PATH="$tool_path" RIVALHUB_BACKUP_SOURCE=instance "$node" --env-file="$snapshot/checkpoint.env" --env-file="$snapshot/instance.env" node_modules/tsx/dist/cli.mjs scripts/db/recovery/checkpoint.ts --stopped-instance-source "$snapshot/running-source.json" --source-manifest "$root/$previous/standby.json" | tee "$snapshot/checkpoint.log"
  fi
  rm -f "$snapshot/checkpoint.env"
  env -i "$node" --env-file="$snapshot/instance.env" "$root/$previous/scripts/instance/readiness.mjs" "$root/$previous"
  instance_ref=$("$node" -e 'console.log(JSON.parse(process.argv[1]).project)' "$candidate_db")
  # Persist before invoking the migrator: an interrupted or partially committed
  # migration can never make automatic application rollback safe.
  "$node" -e 'const fs = require("fs"); const log = fs.openSync(process.argv[1] + "/checkpoint.log", "r"); fs.fsyncSync(log); fs.closeSync(log); if (fs.existsSync(process.argv[1] + "/full-checkpoint.json")) { const receipt = fs.openSync(process.argv[1] + "/full-checkpoint.json", "r"); fs.fsyncSync(receipt); fs.closeSync(receipt); } const fd = fs.openSync(process.argv[1] + "/migration-started", "wx", 0o600); fs.fsyncSync(fd); fs.closeSync(fd); const dir = fs.openSync(process.argv[1], "r"); fs.fsyncSync(dir); fs.closeSync(dir)' "$snapshot"
  env -i PATH="$tool_path" RIVALHUB_INSTANCE_PROJECT_REF="$instance_ref" RIVALHUB_INSTANCE_CONFIRM="$instance_ref" RIVALHUB_INSTANCE_WRITE=yes "$node" --env-file="$snapshot/candidate.env" node_modules/tsx/dist/cli.mjs scripts/instance/provision.ts upgrade "$root/$previous/standby.json" "$release/standby.json" "$snapshot"
  env -i "$node" --env-file="$snapshot/candidate.env" "$release/scripts/instance/readiness.mjs" "$release"
fi
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
