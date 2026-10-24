#!/usr/bin/env bash
# Opt-in host configuration; application restart remains a planned release operation.
set -Eeuo pipefail
mode=${1:---check}
service=${2:-rivalhub-production}
[[ $# -le 2 && ( $mode == --check || $mode == --apply ) && ( $service == rivalhub-production || $service == rivalhub-standby ) ]] || {
  echo 'Usage: configure-journal.sh [--check|--apply] [rivalhub-production|rivalhub-standby]' >&2; exit 1;
}
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/journal
journal=/etc/systemd/journald@rivalhub.conf
dropin=/etc/systemd/system/$service.service.d/50-rivalhub-journal.conf
version=$(systemctl --version | head -n 1)
[[ $version =~ ^systemd\ ([0-9]+) && ${BASH_REMATCH[1]} -ge 245 ]] || { echo 'Requires systemd >= 245.' >&2; exit 1; }
systemctl cat systemd-journald@.service >/dev/null
[[ $(systemctl show "$service.service" -p LoadState --value) == loaded ]] || { echo 'Application service must already be installed.' >&2; exit 1; }
# Preserve any operator-owned policy; this tool only creates absent or identical files.
for pair in "journald.conf:$journal" "service.conf:$dropin"; do
  source_file=$source_dir/${pair%%:*}
  target=${pair#*:}
  [[ -f $source_file ]] || exit 1
  [[ ! -L $target ]] || { echo 'Refusing a symlink configuration target.' >&2; exit 1; }
  if [[ -e $target ]] && ! cmp -s "$source_file" "$target"; then
    echo "Existing configuration differs: $target" >&2; exit 1
  fi
done
if [[ $mode == --check ]]; then
  echo "Compatible host; opt-in targets: $journal and $dropin"
  echo 'No configuration changed. Apply requires --apply; activation requires a planned application restart.'
  exit 0
fi
[[ $(id -u) == 0 ]] || { echo 'Run --apply as root on the verified host.' >&2; exit 1; }
install -d -m 755 "$(dirname "$dropin")"
install -m 644 "$source_dir/journald.conf" "$journal"
install -m 644 "$source_dir/service.conf" "$dropin"
systemctl daemon-reload
echo "Installed journal policy for $service; application and journald were not restarted."
echo 'Activate at the next authorized application restart; read logs using journalctl --namespace=rivalhub.'
