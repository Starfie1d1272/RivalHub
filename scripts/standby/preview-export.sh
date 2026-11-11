#!/bin/sh
set -eu
test -z "${SSH_ORIGINAL_COMMAND:-}"
umask 077
release=/opt/rivalhub-production/current
exec /usr/bin/flock --nonblock --close /run/lock/rivalhub-preview-export.lock \
  /usr/bin/timeout --kill-after=5s 130s /usr/bin/env -i \
  "$release/runtime/node" --env-file=/etc/rivalhub-production/production.env --max-old-space-size=128 \
  "$release/scripts/standby/read-preview-source.mjs"
