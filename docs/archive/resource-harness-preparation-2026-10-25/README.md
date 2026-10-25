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

## Review follow-up: exact telemetry data and version capabilities

The original six reports above are historical preparation reports under the original
coverage rules. Their bytes and `passed` fields are retained; they cannot satisfy the
stricter final integrated acceptance rules below. They did not assert 20 visible views.

The revised driver accepts explicit `--telemetry=raw|summary` and
`--phase=preparation|baseline|integrated`. The default is preparation/raw; modes never
silently switch to make a run pass. Raw expects actual `/admin/analysis` with
`totals.views=20`; summary expects actual `/admin/long-window` with `counts.views=20`.
Both also require the rendered **页面访问** statistic to equal 20. Summary additionally
requires the actual **长窗口汇总** data region and its incomplete-range notice. Both old
and new error fallbacks fail. Response metadata records the actual endpoint, views,
coverage status and count of non-complete segments; no response bodies are retained.
Comparisons must explicitly describe the product's raw-analysis → long-window-summary
semantic change rather than require the new version to call the old endpoint.

The same current Worker bundle/schema runs for both app versions. Its bundle hash is
recorded per run. Local history retention is opted in for 90 days; the canonical
`maintainHistory` function initializes and advances the real D1 checkpoint around the
20-batch seed. No complete history rows or coverage are fabricated. A fresh checkpoint
has genuine missing earlier history; the summary must be partial with at least one
non-complete segment. The new HTTPS fixture test verifies exact 20-view raw data and
this genuinely partial summary against the real Worker/D1. Guards reject arbitrary 200s,
wrong endpoints/counts and false complete history.

For a formal comparison, run this tooling checkout with `--app-root=/path/to/app-checkout`
and build that separate app checkout. This leaves old production source untouched and
uses the same fixture/driver for both versions. Non-preparation modes require
`--expected-sha=<root-frozen-40-character-app-SHA>` equal to that clean checkout's HEAD.
The report separately identifies application SHA, harness SHA/file hashes, G provider
SHA and telemetry Worker bundle hash. Do not transplant instrumentation into v2.24.3.

New preparation/integrated runs require actual completed samples (`count>0`) for all
five fixed B/E/G resource names, plus runtime-health and pool-waiting coverage; merely
listing unobserved names cannot pass. Baseline mode keeps the external RSS/cgroup/HTTP
and exact telemetry checks but does not require new internal counters. Their availability
is explicitly reported from the baseline app source; absence is a version capability,
not a business regression or a zero. Compare shared external measurements across versions.
Final integrated acceptance still requires all new named counters and real summary data.

Integrated mode also rejects `--telemetry=raw` before creating fixtures: final integrated
acceptance requires summary. A mismatched frozen SHA was replayed through the real CLI,
which exited 1 with `FROZEN_APP_SHA_REQUIRED` before any fixture or app started.

Revised production preparation runs passed (same logical seed/workload hash and identical
Worker bundle hash, same app resource limits; both retain full raw reports):

| Report | Exact app source | Actual query | Visible/data views | History | Named resources |
| --- | --- | --- | --- | --- | --- |
| `08-raw-exact-data-and-counters.json` | `c2a0fdb66fe93db1f46f50505addfaea6dbd8c74` (A tooling + main a1c6deb4) | `/admin/analysis` | 20 / 20 | raw | all five completed |
| `09-summary-exact-data-and-counters.json` | `594457bfc3183a3de2d657396c91920a35cdddba` (main after #1147) | `/admin/long-window` | 20 / 20 | partial; 7 non-complete segments | all five completed |

Each run had nine successful document navigations, eight accepted LIVE requests, two
canonicalized reliable requests, two verified receipts/maps, no errors/OOM and all six
cleanup categories successful. The summary run exercised the separate `--app-root`
path on an unchanged, clean main checkout. The recorded query payloads were respectively
48,062 and 2,080 bytes; this is a raw → summary representation change on a small fixture,
not final memory/net optimization benefit. Both remain **preparation**, not frozen final
before/after trials. Seven targeted unit tests, scripts/tests type checking, scoped lint
and Knip passed after the review corrections. The first new fixture test caught a missing
`now` argument to `maintainHistory`; it was corrected before both production runs.
