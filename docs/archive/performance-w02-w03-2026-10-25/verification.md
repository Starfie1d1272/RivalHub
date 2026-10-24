# W02/W03 verification and remaining experiments

This record covers isolated fixtures. It is not production deployment, billing,
LCP or remote cache evidence. W09's canonical revalidation contract is a merge
prerequisite; validation used candidate f29a1c8f with latest main d58ab7c4 in a
private integration worktree. The feature diff does not copy W09 implementation.

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

Relevant local evidence (overlapping suites are not additive): 29 component,
action and API tests passed; 5 durable-delivery, 14 lifecycle and 6 reconciliation
PG tests passed. One real-browser scenario covers durable delivery and both
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
