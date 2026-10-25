# Browser matrix execution budget partition

The system watchdog remains 180,000 ms, including setup. Runs 40143081538
and 40144055247 left approximately 81–97 seconds for the E2E body after local
stack startup, bootstrap and dependency installation. Alphabetical round-robin
into at most seven ordinary runners put admin workbench readiness, Major
qualification and test-match flows together; another runner combined bet receipt
and eight OCR recovery cases. Both exhausted the outer deadline while tests
were still executing. A passed assertion or Playwright summary is not an
execution-budget completion signal.

This change isolates the measured expensive admin readiness, admin content,
qualification and test-match specs. OCR recovery has four cases per project:
its Chromium and mobile Chrome projects get separate runners. Remaining
ordinary specs form deterministic groups of at most two rather than growing
without bound inside seven shards. Existing LIVE, correction and session
isolation remains. Provider and production smoke still run once.

No test, project, success assertion, worker count, retry policy, forbid-flaky
setting or execution deadline is removed or relaxed. The unit test expands each
matrix entry through the actual Playwright project exclusions and checks each
selected runnable `(spec, project)` exactly once, for both full and affected
plans. OCR project selection is passed to Playwright by the workflow. Each
runner still owns its own local fixture stack.

Target E2E-body duration is approximately 65–70 seconds, leaving margin within
the observed worst remaining budget. This partition is based on observed costs,
not a guarantee: the exact candidate's required CI must establish its duration.
Additional runners increase aggregate setup cost; they reduce per-runner packing.

The older 40140698481 four-pass/40-second exit stall remains unconfirmed:
40143081538 reran those same four cases and returned normally (HTML 70 ms,
onExit less than 1 ms, Playwright return 35 ms, fixture cleanup 1 ms). This
partition does not claim to repair that distinct, unreproduced stall.

A separate local cold-cache diagnostic reproduced the test-match heading's
10-second expectation failure: creation returned in 156 ms (transaction 84 ms,
invalidation 2 ms), target RSC first response followed about 7.6 seconds after
its request, and workbench loading continued. The warm retry reached the heading
about 2.7 seconds after clicking. That diagnostic run remained failed under
forbid-flaky; it is not green acceptance or proof of the original CI request's
cause. No database-lock or business-behavior fix is included here.

## Account acceptance integration follow-up

Run 40145170960 at account candidate 86d8858a passed all other shards, but
Major entry and platform statistics shared browser-6. The Major cold attempt
exhausted its original 30-second test budget after reaching the final personal
competition page; its initial navigation took 10.2 seconds, while platform
statistics concurrently took 28 seconds. The full warm retry passed in 6.2
seconds, so forbid-flaky correctly failed the job. Embedded report steps show
real login, team creation and entry creation completed before the timeout; this
is not the old post-summary exit stall or an outer deadline.

Major entry now gets its own runner like the other measured expensive flows.
No journey assertion, fixture, test deadline or retry policy changes. The same
full/affected project-coverage and no-duplicate tests cover this extra partition.

Run 40145516127 verified the independent Major runner and every other runner
except the next ordinary pair: platform statistics and predictions. Statistics
cold navigation took 11.0 seconds, its later redirect/navigation took 5.3 seconds,
and the unchanged 30-second budget expired before its final focus assertion;
its warm full retry passed in 11.2 seconds. The co-scheduled prediction journey
took 56.4 seconds. These two measured cross-route journeys now also get separate
runners. They were the same adjacent ordinary pair, so removing both preserves
the remaining ordinary pair contents. All original assertions, including the
statistics final focus assertion and prediction export, remain.

After syncing main 3830c046, run 40146466403 exposed database-wide counter
interference: new admin-immediate-boundaries shared browser-3 with admin BET
hydration; the directory counter delta was 3 instead of exactly 1. The warm
retry passed, and all other shards passed. The evidence spec's advisory lock
only coordinates its own projects; the unrelated BET spec does not take it.
The evidence spec now runs on an independent database for each project, like
OCR project partitioning. Its exact SQL assertions, both viewport journeys,
internal serialization, two configured workers and all deadlines remain.
