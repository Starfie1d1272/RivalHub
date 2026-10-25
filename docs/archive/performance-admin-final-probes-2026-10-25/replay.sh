#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
probe_dir=docs/archive/performance-admin-final-probes-2026-10-25
git diff --exit-code -- src/lib/production/bilibili.ts src/lib/telemetry/server.ts
git apply --check --unidiff-zero "$probe_dir/local-fixture.patch"
mkdir -p /tmp/admin-final-probes
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/admin-final-probes/key.pem -out /tmp/admin-final-probes/cert.pem \
  -days 1 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
git apply --unidiff-zero "$probe_dir/local-fixture.patch"
restore_probe() {
  git apply --reverse --unidiff-zero "$probe_dir/local-fixture.patch"
  rm -f /tmp/admin-final-probes/key.pem /tmp/admin-final-probes/cert.pem
}
trap restore_probe EXIT
export NODE_EXTRA_CA_CERTS=/tmp/admin-final-probes/cert.pem
export PRODUCT_TELEMETRY_ENABLED=1 PRODUCT_TELEMETRY_MEASUREMENT_V1=1
export PRODUCT_TELEMETRY_ORIGIN=https://localhost:9468
export PRODUCT_TELEMETRY_ENDPOINT=https://localhost:9468/v1/batches
export PRODUCT_TELEMETRY_ADMIN_KEY=local-fixture-admin-key-only-00000000
export PRODUCT_TELEMETRY_SIGNING_KEY=local-fixture-signing-key-only-000000
export PRODUCT_TELEMETRY_ACCOUNT_KEY=local-fixture-account-key-only-000000
export RIVALHUB_RELEASE_COMMIT=bounded-probe
export RIVALHUB_ADMIN_FINAL_PROBE=1 RIVALHUB_ADMIN_PROBE_PORT=9468
export RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 PLAYWRIGHT_RETRIES=0
unset RIVALHUB_ADMIN_PROBE_PHASE
pnpm test:e2e -- --config "$probe_dir/playwright.config.ts" --project chromium --workers 1 --reporter line
