#!/usr/bin/env bash
# Install a verified immutable production package; never runs database migrations.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on the verified production host.' >&2; exit 1; }
archive=$(realpath "${1:?Usage: install-production.sh ARCHIVE PRODUCTION_ENV}")
env_file=$(realpath "${2:?Production environment file required}")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name=$(basename "$archive" .tar.gz)
[[ $name =~ ^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}$ ]] || { echo 'Invalid package name.' >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
root=/opt/rivalhub-production
release="$root/releases/$name"
config=/etc/rivalhub-production/production.env
unit=/etc/systemd/system/rivalhub-production.service
[[ ! -e $release ]] || { echo 'Release already exists; inspect before retry.' >&2; exit 1; }
[[ -f $script_dir/rivalhub-production.service ]] || { echo 'Matching service unit required.' >&2; exit 1; }
install -d -m 755 "$root/releases"
install -d -m 700 /etc/rivalhub-production "$root/rollback"
mkdir -m 750 "$release"
tar -xzf "$archive" -C "$release" --no-same-owner
env -i "$release/runtime/node" --env-file="$env_file" --input-type=module - "$release" "$name" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const manifest = JSON.parse(readFileSync(`${root}/standby.json`, 'utf8'));
const { assertProductionStandbyEnvironment } = await import(pathToFileURL(`${root}/scripts/standby/start-production.mjs`));
assertProductionStandbyEnvironment(manifest);
if (`rivalhub-production-${manifest.sourceCommit}-${manifest.configurationSha256.slice(0,12)}` !== process.argv[3]) throw new Error('Package identity/name mismatch.');
JS
if ! id rivalhub-production >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin rivalhub-production
fi
chmod -R o-rwx "$release"
chown -R root:rivalhub-production "$release"
mkdir -p "$release/.next/cache"
chown -R rivalhub-production:rivalhub-production "$release/.next/cache"
previous=$(readlink "$root/current" || true)
if [[ -n $previous ]]; then
  [[ $previous == releases/rivalhub-production-* && -f $root/$previous/standby.json && -f $config && -f $unit ]] || { echo 'Previous rollback state incomplete.' >&2; exit 1; }
fi
snapshot="$root/rollback/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$snapshot"
printf '%s\n' "$previous" > "$snapshot/previous-release"
[[ ! -f $config ]] || cp -p "$config" "$snapshot/production.env"
[[ ! -f $unit ]] || cp -p "$unit" "$snapshot/service"
rollback() {
  trap - ERR
  systemctl stop rivalhub-production || true
  if [[ -n $previous ]]; then
    ln -s "$previous" "$root/current.rollback"
    mv -Tf "$root/current.rollback" "$root/current"
    cp -p "$snapshot/production.env" "$config"
    cp -p "$snapshot/service" "$unit"
    systemctl daemon-reload
    systemctl start rivalhub-production || echo 'Rollback service start failed; manual recovery required.' >&2
  fi
  echo "Candidate failed. Rollback evidence: $snapshot; inspect service and release identity." >&2
  exit 1
}
trap rollback ERR
install -m 600 "$env_file" "$config"
install -m 644 "$script_dir/rivalhub-production.service" "$unit"
ln -s "releases/$name" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl daemon-reload
systemctl restart rivalhub-production
healthy=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3032/api/system/release > "$root/last-release-check.json"; then
    if "$release/runtime/node" --input-type=module - "$root/last-release-check.json" "$release/standby.json" <<'JS'
import { readFileSync } from 'node:fs';
const actual = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const expected = JSON.parse(readFileSync(process.argv[3], 'utf8'));
if (Object.keys(actual).sort().join(',') !== 'releaseCommit,releaseTag' || actual.releaseCommit !== expected.sourceCommit || actual.releaseTag !== expected.releaseTag) process.exit(1);
JS
    then healthy=true; break; fi
  fi
  sleep 2
done
[[ $healthy == true ]] || rollback
systemctl enable rivalhub-production
trap - ERR
printf '%s\n' "$snapshot" > "$root/previous-snapshot"
echo "Production candidate active: $name. DNS and business acceptance remain separate."
