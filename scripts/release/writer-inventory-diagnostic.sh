#!/usr/bin/env bash
# Read-only observations. Do not print remote command output or credentials.
set -uo pipefail
umask 077
scratch=$(mktemp -d)
remote=''
cleanup() {
  if [[ -n "$remote" ]]; then ssh "${opts[@]}" -p 52222 root@47.103.131.158 "rm -rf -- $remote" >/dev/null 2>&1 || true; fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
summary="$scratch/summary"
printf '### Release writer inventory\n\n' > "$summary"
failed=0
for state in in_progress queued waiting requested pending; do
  if response=$(timeout 15s gh api "repos/Starfie1d1272/RivalHub/actions/runs?status=$state&per_page=100" 2>/dev/null) && count=$(jq -er --arg run "${GITHUB_RUN_ID:-}" 'if .total_count <= 100 then [.workflow_runs[] | select((.id|tostring) != $run)] | length else error("incomplete") end' <<<"$response" 2>/dev/null); then
    printf -- '- Actions %s: %s runs; attribution required.\n' "$state" "$count" >> "$summary"
  else
    printf -- '- Actions %s: unavailable or incomplete.\n' "$state" >> "$summary"
    failed=1
  fi
done
if [[ "${LINUX_DEPLOY_SSH_KEY:-}" != *'PRIVATE KEY'* || "${LINUX_DEPLOY_KNOWN_HOSTS:-}" != *'[47.103.131.158]:52222'* ]]; then
  printf '%s\n' '- Host and database: deployment identity unavailable.' >> "$summary"
  failed=1
else
  printf '%s\n' "$LINUX_DEPLOY_SSH_KEY" > "$scratch/key"
  printf '%s\n' "$LINUX_DEPLOY_KNOWN_HOSTS" > "$scratch/known_hosts"
  chmod 600 "$scratch/key" "$scratch/known_hosts"
  opts=(-i "$scratch/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$scratch/known_hosts" -o ConnectTimeout=15)
  remote=$(ssh "${opts[@]}" -p 52222 root@47.103.131.158 'mktemp -d /tmp/rivalhub-inventory.XXXXXXXX' 2>/dev/null) || remote=''
  if [[ ! "$remote" =~ ^/tmp/rivalhub-inventory\.[A-Za-z0-9]{8}$ ]]; then
    remote=''
    printf '%s\n' '- Host and database: connection unavailable.' >> "$summary"
    failed=1
  else
    sed 's/from "\.\/supabase-ca"/from "\.\/supabase-ca.ts"/' src/db/postgres-connection.ts > "$scratch/postgres-connection.ts"
    sed 's/from "\.\/remote-environment"/from "\.\/remote-environment.ts"/' scripts/db/production-environment.ts > "$scratch/production-environment.ts"
    if scp -q "${opts[@]}" -P 52222 scripts/standby/writer-inventory-host.py scripts/standby/writer-inventory-db.mjs "$scratch/postgres-connection.ts" "$scratch/production-environment.ts" scripts/db/remote-environment.ts src/db/supabase-ca.ts "root@47.103.131.158:$remote/" 2>/dev/null; then
      if result=$(ssh "${opts[@]}" -p 52222 root@47.103.131.158 "timeout 30s python3 $remote/writer-inventory-host.py" 2>/dev/null) && jq -e '.host | [.unit,.outside,.unreadable,.unattributedTimers,.unattributedCronLines] | all(type == "number" and . >= 0)' <<<"$result" >/dev/null 2>&1; then
        printf -- '- Host counts: %s\n' "$(jq -c '.host | {unit,outside,unreadable,unattributedTimers,unattributedCronLines}' <<<"$result")" >> "$summary"
      else
        printf '%s\n' '- Host inventory: unavailable or incomplete.' >> "$summary"; failed=1
      fi
      if result=$(ssh "${opts[@]}" -p 52222 root@47.103.131.158 "active=\$(readlink /opt/rivalhub-production/current) && case \"\$active\" in releases/rivalhub-production-*) ;; *) exit 1;; esac && timeout 30s env -i RIVALHUB_DB_TARGET=production RIVALHUB_PRODUCTION_PROJECT_CONFIRM=eurxkguokrkvpcsmxuru RIVALHUB_PRODUCTION_DB_HOST_CONFIRM=aws-0-ap-northeast-1.pooler.supabase.com:6543 /opt/rivalhub-production/\$active/runtime/node --env-file=/etc/rivalhub-production/production.env $remote/writer-inventory-db.mjs /opt/rivalhub-production/\$active $remote/postgres-connection.ts $remote/production-environment.ts" 2>/dev/null) && jq -e '.database | [.roles,.hidden,.otherRoles,.prepared] | all(type == "number" and . >= 0)' <<<"$result" >/dev/null 2>&1; then
        printf -- '- Database counts: %s\n' "$(jq -c '.database | {roles,hidden,otherRoles,prepared}' <<<"$result")" >> "$summary"
      else
        printf '%s\n' '- Database inventory: unavailable or incomplete.' >> "$summary"; failed=1
      fi
    else
      printf '%s\n' '- Host and database: diagnostic transfer failed.' >> "$summary"; failed=1
    fi
  fi
fi
printf '%s\n' '- External hosts, writer ownership and an owner-held stop window: **not proven**.' '- This diagnostic does not authorize production promotion.' >> "$summary"
cat "$summary"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$summary" >> "$GITHUB_STEP_SUMMARY"; fi
exit "$failed"
