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
