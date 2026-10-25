# Resource integration harness preparation (not a final comparison)

This evidence validates the local driver and cleanup on intermediate application source
`6f60b37b4b1200cefb898f026d25c0748916eb0f`. It is not final integration acceptance,
a production measurement, an optimization benefit, or evidence explaining the historical
21:48 OOM. The root has not frozen the final comparison SHAs. Existing runtime observation
and anonymous six-run baseline are delivered by #1138; this change only adds the
full authenticated combination driver and fail-closed resource-reading guards.

## Reproduction

Use a Linux local-development environment with canonical Local Supabase **including
Realtime**, migrated PG, Docker, OpenSSL and the repository's installed Chromium. Follow
`docs/operations/local-development.md`; only local synthetic users/matches/points are used.
Install dependencies with the frozen lockfile. Do not point this driver at production.
The app is built and started from the current checkout; the fixture provider must be a
complete, separately installed G checkout containing `scripts/db/mizar-http-resource-fixture.ts`.
The successful current provider was `286d0449f2d3de692c4e291bee52d6c3952d6e70`.

```sh
pnpm exec tsx scripts/db/run-server-cli.ts scripts/observability/resource-integration.ts \
  sha256:dc1f22974dab4be31a8b56d58cb1f8fc218e83de83ccd831d885b3d7ac1223fb \
  resource-prepare-v1 /workspace/RivalHub-G-fixture --build
```

The image argument must be an already available compatible Docker image ID; the driver
never pulls an image. The actual app Node executable is the project's locked executable
mounted from this checkout, not the image's Node. If a build already exists, omit `--build`;
readiness still requires HTTP 2xx and the exact local release tag/commit from the release
endpoint. Stale build identity fails. A missing G provider, missing resource fields,
resource-limit drift, an unexpected HTTP/outcome, missing coverage, or failed cleanup
cannot pass. CLI exit codes are 0 success, 1 errors, 2 missing coverage/provider.

Manifests and credentials remain private in `.agent-tmp` (umask 077). G owns seed,
read-only verification and cleanup; A imports no copy of those business rules. LIVE is
sent through two distinct match HTTP producers (four snapshots each, 500ms cadence),
then each producer's original reliable envelope exactly once, last. An unknown result
stops that producer without replay. The G manifest's 15-minute window is a harness
window, not a server credential TTL. Always let `finally` cleanup complete.

## Environment and actual coverage

The application is real production Next, Node 24.22.0, Chromium 156.0.8078.4, with local
Supabase Auth, migrated PG and Realtime. Only the single app container is constrained:
1 CPU (`100000 100000`), 512 MiB memory, zero swap, 128 PIDs. PG/Auth/Realtime, browser,
driver and the telemetry Worker are outside that app budget. Docker `exec cat` sampling
is a small additional process inside the cgroup. No production host/SSH, remote database,
real financial data, OCR, production bootstrap or paid endpoint was used.

Two real password logins create isolated user/admin browser contexts. A local state-only
login/register toggle proves React handlers are attached before submitting credentials.
The user sees seeded BET and the full profile statistics; the admin sees the real local
telemetry analysis. Twenty deterministic two-event batches seed the actual Worker/D1,
served through temporary loopback HTTPS and a per-run trusted CA; TLS verification stays
on. The runtime app queries the actual analysis endpoint. Three document jobs and both
HTTP producers start at the recorded combination barrier. Each document job navigates
twice, then three single warm navigations run. Finally the driver samples for 65 seconds
with the authenticated browser contexts still open: this is authenticated browser idle,
not a claim of zero background client activity. Request ordering/timings and byte counts
are preserved, as are process RSS/HWM, cgroup current/peak and the periodic pool events.
The logical seed and workload hash define the repeatable request mix; generated ownership
IDs and relative timestamps necessarily differ across runs.

The current-provider run (`07-current-g-passed.json`) passed with 9 document HTTP 200s,
8 accepted LIVE HTTP 200s and 2 canonicalized reliable HTTP 200s. Read-only verification
found exactly two receipts and two completed maps. Runtime health/pool and HTTPS analysis
coverage all passed; all six cleanup categories succeeded and the app remained running
with `oomKilled=false`. There are 74 resource samples. Max process sampled RSS was
248.89 MiB, process HWM 251.01 MiB; max sampled cgroup charge was 170.66 MiB and cgroup
peak 171.05 MiB. Final authenticated idle RSS was 232.65 MiB and cgroup charge 153.31 MiB.
RSS includes shared mappings and differs from cgroup charge; these figures must not be
added. Peak waiter count was 11, acquired 239 / failed 0, maximum acquire 151.76ms,
maximum hold 325.52ms. These are preparation values, not improvements or a budget change.
The telemetry cohort is deliberately small and proves transport/analysis coverage;
it does not model historical high-cardinality dashboard memory.

This intermediate application source has no B/E/G consumers of the fixed resource
counters. All five resource names are explicitly recorded as unobserved, not zero.
The final source must repeat coverage and capture those consumers before drawing
resource-budget conclusions. Resident cache bytes and in-flight fill peaks are distinct
accounting dimensions; this driver does not estimate one from the other or sum them.

## Retained failures and limits

All six JSON files are byte-for-byte raw reports; source hashes in each successful report
identify the exact driver files used. The driver was uncommitted when these runs happened;
the app SHA, local build ID and G provider SHA are recorded separately.

- `01`: telemetry seed returned 400 because its first timestamp spacing exceeded admission
  age; fixed spacing to 30 seconds. No app started, cleanup passed.
- `02`: installed Chromium was missing; app identity passed, browser launch failed.
  Installed the pinned browser, cleanup passed.
- Attempt `03`: static import of the existing ESM baseline guard failed tsx's CJS transform
  on top-level await before fixtures ran. Changed to dynamic import; no report was written.
- `04`: Realtime was absent from the canonical stack. All 8 LIVE responses were discarded
  (`broadcast_unavailable`); receipts/pages passed but coverage correctly failed (exit 2).
  Restarted through canonical full bootstrap including Realtime; cleanup passed.
- `05`: first full pass using the older G provider `f2c2f5cb8e6912d29771d43cf550ca7ba7cfa95b`.
  Retained, superseded by `07`.
- `06`: after updating G to `286d0449`, login navigation timed out before combination.
  Cleanup passed. Added the state-only hydration probe and login POST/status evidence;
  `07` passed. The earlier intermittent login cause remains unknown; a pass does not
  establish a product fix or explain G's earlier dev-only mounting symptom.

Final frozen-SHA before/after three-round resource comparisons and any net optimization
benefit remain unrun. No production release or load test was performed.

After `07`, the driver additionally rejects a non-running/nonzero-exit app state at final
inspection even without an OOM flag. The captured successful run already had running/0;
this guard does not alter its recorded requests or resource measurements.

Host verification: scripts type checking and file-scoped ESLint passed; five unit tests
cover missing/invalid resource accounting and strict identity/HTTP failure preservation.
Pure development tooling/test evidence changes shipped behavior nowhere, so no Changeset
is needed for this follow-up under CONTRIBUTING.md. Revert this PR to remove the driver;
the #1138 runtime observation provider remains independent.
