#!/usr/bin/env bash
# Run as root on the Preview host with a CI archive and a private environment file.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on the Preview host.' >&2; exit 1; }
archive=$(realpath "${1:?Usage: install-preview.sh ARCHIVE PREVIEW_ENV}")
env_file=$(realpath "${2:?Preview environment file required}")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
name=$(basename "$archive" .tar.gz)
[[ $name =~ ^rivalhub-standby-[a-f0-9]{40}$ ]] || { echo 'Invalid package name.' >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
root=/opt/rivalhub-standby
release="$root/releases/$name"
[[ ! -e $release ]] || { echo 'Release exists; inspect or select another package.' >&2; exit 1; }
if ! id rivalhub-standby >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin rivalhub-standby
fi
install -d -m 755 "$root/releases"
install -d -m 700 /etc/rivalhub-standby
mkdir "$release"
tar -xzf "$archive" -C "$release"
# Validate the actual packaged target before replacing the running service.
"$release/runtime/node" --env-file="$env_file" --input-type=module - "$release" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { assertStandbyEnvironment } = await import(pathToFileURL(`${root}/scripts/standby/start.mjs`));
assertStandbyEnvironment(JSON.parse(readFileSync(`${root}/standby.json`, 'utf8')));
JS
chmod -R o-rwx "$release"
chown -R root:rivalhub-standby "$release"
mkdir -p "$release/.next/cache"
chown -R rivalhub-standby:rivalhub-standby "$release/.next/cache"
previous=$(readlink "$root/current" || true)
if [[ -e /etc/rivalhub-standby/preview.env ]]; then
  cp -p /etc/rivalhub-standby/preview.env /etc/rivalhub-standby/preview.env.previous
fi
install -m 600 "$env_file" /etc/rivalhub-standby/preview.env
install -m 644 "$script_dir/rivalhub-standby.service" /etc/systemd/system/rivalhub-standby.service
ln -s "releases/$name" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl daemon-reload
systemctl disable rivalhub-standby
systemctl restart rivalhub-standby
healthy=false
for attempt in {1..10}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3031/api/system/release > "$root/last-release-check.json"; then
    if "$release/runtime/node" --input-type=module - "$root/last-release-check.json" "${name#rivalhub-standby-}" <<'JS'
import { readFileSync } from 'node:fs';
if (JSON.parse(readFileSync(process.argv[2], 'utf8')).releaseCommit !== process.argv[3]) process.exit(1);
JS
    then healthy=true; break; fi
  fi
  sleep 2
done
if [[ $healthy != true ]]; then
  systemctl stop rivalhub-standby
  if [[ -n $previous ]]; then
    ln -s "$previous" "$root/current.rollback"
    mv -Tf "$root/current.rollback" "$root/current"
    cp -p /etc/rivalhub-standby/preview.env.previous /etc/rivalhub-standby/preview.env
  fi
  echo 'Candidate failed identity check; previous service restored when available.' >&2
  exit 1
fi
printf '%s\n' "$previous" > "$root/previous-release"
systemctl stop rivalhub-standby
echo "Preview installed and stopped: $name"
