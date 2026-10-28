#!/usr/bin/env bash
set -euo pipefail
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' '{"total_count":1,"workflow_runs":[{"id":5,"path":"sensitive-workflow-secret"}]}'
STUB
chmod +x "$scratch/gh"
set +e
output=$(PATH="$scratch:$PATH" GITHUB_RUN_ID=8 bash scripts/release/writer-inventory-diagnostic.sh 2>&1)
status=$?
set -e
[[ $status == 1 ]]
[[ "$output" == *'Actions in_progress: 1 runs'* ]]
[[ "$output" == *'External hosts, writer ownership'* ]]
[[ "$output" != *'sensitive-workflow-secret'* ]]
cat > "$scratch/ssh" <<'STUB'
#!/usr/bin/env bash
command=${!#}
case "$command" in
  *'mktemp -d'*) printf '%s\n' '/tmp/rivalhub-inventory.ABCDEFGH' ;;
  *writer-inventory-host.py*) printf '%s\n' '{"host":{"unit":1,"outside":2,"unreadable":1,"unattributedTimers":3,"unattributedCronLines":4}}'; exit 1 ;;
  *writer-inventory-db.mjs*) printf '%s\n' 'sensitive-db-error' >&2; exit 1 ;;
  *'rm -rf'*) exit 0 ;;
  *) exit 1 ;;
esac
STUB
cat > "$scratch/scp" <<'STUB'
#!/usr/bin/env bash
if [[ "${TEST_SCP_FAIL:-}" == yes ]]; then echo 'sensitive-transfer-error' >&2; exit 1; fi
STUB
chmod +x "$scratch/ssh" "$scratch/scp"
for mode in yes no; do
  set +e
  output=$(PATH="$scratch:$PATH" GITHUB_RUN_ID=8 LINUX_DEPLOY_SSH_KEY='PRIVATE KEY sentinel' LINUX_DEPLOY_KNOWN_HOSTS='[47.103.131.158]:52222 sentinel' TEST_SCP_FAIL="$mode" bash scripts/release/writer-inventory-diagnostic.sh 2>&1)
  status=$?
  set -e
  [[ $status == 1 ]]
  [[ "$output" != *sensitive* && "$output" != *sentinel* ]]
  if [[ "$mode" == yes ]]; then
    [[ "$output" == *'diagnostic transfer failed'* ]]
  else
    [[ "$output" == *'"unreadable":1'* && "$output" == *'Host inventory: partial'* && "$output" == *'Database inventory: unavailable'* ]]
  fi
done
cat > "$scratch/ssh" <<'STUB'
#!/usr/bin/env bash
echo 'sensitive-ssh-error' >&2
exit 255
STUB
chmod +x "$scratch/ssh"
set +e
output=$(PATH="$scratch:$PATH" LINUX_DEPLOY_SSH_KEY='PRIVATE KEY sentinel' LINUX_DEPLOY_KNOWN_HOSTS='[47.103.131.158]:52222 sentinel' bash scripts/release/writer-inventory-diagnostic.sh 2>&1)
status=$?
set -e
[[ $status == 1 && "$output" == *'connection unavailable'* && "$output" != *sensitive* && "$output" != *sentinel* ]]
