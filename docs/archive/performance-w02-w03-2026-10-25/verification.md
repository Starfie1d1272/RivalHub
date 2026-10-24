# W02/W03 verification and remaining experiments

This record covers isolated fixtures. It is not production deployment, billing,
LCP or remote cache evidence. W09's canonical revalidation contract is now merged on main (49c6c7fd).
The feature has synchronized main and validates that formal contract, including
known veto_step and conservative legacy veto/map_plan behavior.

| Task / route | State | Evidence / limitation |
| --- | --- | --- |
| BP actions: changed receipt | Implemented, tested | Actual changes differ from outcome; stale timeout and idempotent start commits covered in PG. |
| BP map completion / rewind | Implemented, tested | `map_plan` receipt and durable fact; real timeout side-pick completion and map replacement/deletion retain broad invalidation. |
| GET / veto-room | Implemented, tested | Read-only pending boolean; existing snapshot SELECT combines pending lookup; no command replay on GET. |
| Boundary reconcile | Implemented, tested | Single flight, confirmed boundary, retry backoff and visible recovery; quiet room can drain durable cache obligation. |
| Clock / unknown | Implemented, tested | Monotonic anchored time; submit appeal and rejected resolution recover on authorized same-revision facts, including projection failure and lost response. |
| Postcommit invalidation | Implemented, tested | PG generation coalescing, rollback, concurrent generation CAS, failed hard-expire then no-change reconcile, archived scheduler recovery. |
| Browser unknown / durable delivery | Implemented, tested | Real Next/action/GET/isolated PG, actual COMMIT then response abort for submit/reject; cache fault cleared and generation delivered; no replay or page error. |
| BFCache restore | Handler implemented; actual hit still requires experiment | Component persisted-pageshow test passes. Real navigation back was denied BFCache by Chromium: no-store resources, dev WebSocket and delegate reasons. No BFCache hit claimed. |
| Ready / stage / fingerprint | Consumers implemented | Real body ContentReady, fixed stage boundaries, local error fingerprint; local telemetry cohort disabled, no production ready/LCP claim. |
| Mizar heartbeat | Implemented, tested | Timestamp update outside authority transaction; database-clock throttle; pool-busy skip; SHARE authority and Broadcast remain inside authority lock. |
| Repeated BET trigger dirtying | Implemented, tested | Same locked five-market fixture: old repeated UPDATEs 6, new 0; exact lock timestamp unchanged and dirty remains true. BP delivery generation adds its own intentional durable writes. |
| Complete writer/trigger lock protocol | Follow-up in progress | Season-first candidates retain UPDATE; requires roster/Demo/correction/worker closure and coordinated old-worker drain before release. |

Relevant local evidence (overlapping suites are not additive): 42 component,
action, API and cache-contract tests passed; the latest formal-contract PG batch
has 17 passing tests including 7 durable-delivery cases. Both archived/due
lifecycle intersections report the domain error while delivering the watermark.
Earlier lifecycle and reconciliation evidence is overlapping. One real-browser scenario covers durable delivery and both
same-revision lost-response commands. Initial Mizar/trigger evidence is retained
in the PR description; new required CI is mandatory for the final commit.

Minimum replay commands use canonical local isolation:

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/veto-invalidation-delivery.test.ts tests/integration/db/veto-reconcile.test.ts tests/integration/db/veto-appeal-lifecycle.test.ts tests/integration/db/veto-lifecycle-reader.test.ts
pnpm exec vitest run tests/unit/components/veto-room-requests.test.tsx tests/unit/actions/veto-room-access.test.ts tests/unit/api/matches/veto-room.test.ts
```

The browser fault harness is a temporary private fixture, not a production hook
or a permanent mock of PostgreSQL. Neither injected fault code nor credentials
are committed. No production mutation or deployment was performed.

BP-03 remaining evidence is explicit: the 2+1 SELECT measurement above covers
core/projection only, not an entire HTTP request, outer auth or BEGIN/COMMIT.
Start actors and timing are batched; command RETURNING reuses locked steps
(2 step reads verified). Start/command reuse request authorization in projection.
GET/reconcile still perform visibility/scope work before snapshot; draft auth
reuse and complete HTTP footprint remain follow-up work, not a claimed HTTP
query-count improvement in this PR.
