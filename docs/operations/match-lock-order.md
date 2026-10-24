# Event and match writer lock protocol

Event writers acquire the existing season UPDATE fence before any official
match or child row, and retain it to commit. This intentionally preserves event
serialization; no throughput improvement from weaker season locks is claimed.
An unlocked scope discovery is followed by season lock, match lock and a scope
recheck. Scope changes fail closed instead of continuing under the wrong event.

| Writer family | First locks and retained closure |
| --- | --- |
| BP/start/map/result/scheduling | season UPDATE → match UPDATE → session/lineup/map children → trigger-owned prediction outboxes |
| Result correction | same fence; public plan/adjudication preserve archived inspection; applying correction rejects archived; downstream deletes stay in same event transaction |
| BET stake | user SHARE → season UPDATE → complete official parent set sorted by ID → all parent maps sorted ID → all veto sessions sorted ID → program UPDATE → fresh market/facts/receipt |
| Free prediction | active verified user SHARE → season UPDATE → match UPDATE → private choice/receipt; no BET program lock |
| Major/qualification/bracket | existing season UPDATE before run, match and dependent facts; never upgrade an earlier weaker season lock |
| Postevent final result / honors / adjudications | season UPDATE before final-result, honor or adjudication rows; revocation discovers and rechecks scope; archive uses the same order and explicit postevent channels remain allowed |
| Postmatch | season UPDATE → match UPDATE → report/commentator; explicitly permitted archive channels remain accessible |
| MVP settlement | season UPDATE SKIP LOCKED → match UPDATE SKIP LOCKED → votes read and winner/audit write; preserves nonblocking admission |
| Time auto-award/default lineup | season UPDATE → match UPDATE → proposal/coverage/lineups; ordinary archive guard applies |
| Demo submit/review/recheck/projection repair | existing identity gate → lineage advisory → season UPDATE before any import or match row. Existing import/match suborder is safe only while this exclusive event fence is retained. Empty-lineage advisory and unavailable-target classification remain canonical. |
| Identity retirement | identity gate → discover all confirmed-import identity dependencies across events plus audit event → sorted season UPDATE and affected match UPDATE → identity row recheck → imports/program → audit; scope is not restricted to the page season |
| Identity merge | identity gate → sorted user UPDATE → existing fingerprint/authority guards → installation UPDATE NOWAIT → full cross-event closure discovery → sorted season/match UPDATE NOWAIT → reparent/import/stat/MVP writes; contention rolls back before any facts change and requires fresh preflight |
| Mizar revoke | installation UPDATE → season UPDATE → complete active source scope UPDATE → audit; installation fence excludes ingress/LIVE, season fence excludes manual source writers |
| Mizar reliable/source | installation SHARE → canonical season/match boundary → live source; display heartbeat is separately committed by the W02 implementation, never upgraded under authority SHARE |
| LIVE broadcast | installation SHARE → match/source SHARE and broadcast inside authority; no event write or lock weakening |
| Roster confirmation | discover roster parent → season/match → roster UPDATE and recheck association; old child-first entry is incompatible |
| OCR save/clear | `lockMatchForEvidenceInTx`: season UPDATE → match SHARE → map UPDATE/stat rows, preserving post-event evidence policy; no KEY SHARE substitution |

`lockMatchInTx` enforces mutation archive policy. `lockMatchForInspectionInTx`
retains UPDATE but permits explicit archived inspection/adjudication.
`lockMatchForEvidenceInTx` permits existing evidence channels and retains SHARE
on the match. These are lock primitives, never authorization substitutes.

Trigger closure must include all parents selected for an event market, their
complete maps and veto sessions in the same transaction before a BET program
lock. It must not be reduced to current page/stage or loaded maps. Workers
holding a financial program may read official facts but must not acquire later
official row locks. Program locks, DB clock boundaries, settlement/frozen facts,
BigInt pool conservation and correction/withdrawal hard expiry remain intact.

## Coordinated switch

The canonical release owner remains [release.md](./release.md). This protocol
adds a coordinated quiescence prerequisite for the first lock-order switch and
its rollback; it does not authorize this implementation agent to stop services,
change production settings or deploy. The release coordinator executes it in
the existing approved maintenance window. Match-first old workers and
season-first new writers are incompatible: isolated match and postevent audit
barriers both reproduce `40P01`. No blind replay fixes that compatibility gap.

1. Freeze the canonical previous Production identity using the release owner,
   record the exact integrated candidate and eligible rollback source, and
   finish required CI, migration replay/N/N+1 and isolated consumer barriers.
   Include roster, OCR evidence, BET/free, BP, Mizar, Demo and postevent consumers;
   a helper-only deployment is incomplete. Build candidate artifacts before
   the outage. Do not run staging/fixture mutations against Production.
2. Before finalize, the release owner inventories and stops independent
   production CLI/backfill/import/repair/identity-merge jobs and other workers,
   including queued/in-progress Actions and other operator terminals/hosts.
   Hold that stop window through acceptance. The deploy flock and HTTP service
   do not fence independent writers. Unknown roles or unconfirmed worker scope
   block the switch; two empty database samples do not prevent a future CLI.
3. Complete the release owner's existing migration/verify and required
   backfill gates while the previous application remains available. Then run
   normal finalize: its canonical and localhost previous-identity checks must
   happen **before** stopping the app. Do not manually stop it before invoking
   the installer; that defeats these identity preconditions.
4. Use the reviewed executable quiescence installer described in
   [release.md](./release.md): after identity checks it stops the single current
   systemd service and drains actual application-role PostgreSQL transactions,
   including pooler work, twice before environment/current changes and start.
   The HTTP stop also blocks actions, Mizar and HTTP cron/watchdog dispatch.
   Expected failed dispatch during the outage is not successful execution.
   Timeout, invisible/unknown work or drain failure keeps the service stopped;
   no automatic backend termination, credential change or blind command replay.
   The old and new lock protocols must never execute concurrently. Until the
   executable release prerequisite is merged and verified, this lock PR alone
   is not deployable evidence.
5. Verify the candidate's exact identity and smoke, then resume independent
   writers only at the same accepted source. Verify scheduler, durable BP
   pending delivery and Mizar authority. Unknown requests recover through
   receipts/facts; disconnection does not prove rollback. Concurrent/fault
   business writes remain confined to isolated fixtures; Production checks
   are low-frequency read-only observations.

### Rollback and uncertain outcome

Rollback follows the same admission stop, old-process exit and bounded database
drain before starting the chosen previous source. Use the frozen previous
identity and existing capability checks/installation rollback; do not infer the
rollback target from the largest tag. If identity or install outcome is unknown,
read back canonical identity and host state first, then reconcile through the
release owner. Do not issue another install or rollback blindly.

Keep the additive 0096/0097/0098 migration chain and durable acknowledgements;
the old identity registry will fail closed on the new receipt FK until its
registry is compatible. Normal rollback does not reverse DDL, erase generations, reset published
watermarks, or delete OCR receipts. The old BP worker does not consume the new
delivery watermark. If the chosen old source lacks that worker, its scheduler
success cannot prove pending delivery completed. Pending obligations remain
unconfirmed and must be recovered by a compatible forward source; any required
public-cache hard expiry remains a release acceptance gap until its canonical
owner confirms it. Do not keep a new season-first worker beside an old
match-first application as a workaround. If an eligible consistent rollback
source or cache-consistency recovery is unavailable, retain the stopped state
and report that exact blocker instead of claiming a safe rollback.

## Isolated evidence and remaining closure

The match barrier holds a season in one connection, observes the new helper
waiting via `pg_blocking_pids`, then takes its match SHARE. A companion barrier
archives the season while the writer waits and proves mutation denial while
explicit inspection remains possible. Different matches within one event still
serialize at the existing UPDATE fence by design. A separate legacy barrier
reproduces exactly one `40P01`, without replaying either command.

The postevent barrier additionally includes the **real audit season foreign-key
edge**: old confirmation holds the final-result row while its audit insert waits
for season; archive's next final-result acquisition closes the old cycle. New
confirmation waits on season first, commits its confirmation and audit, and the
actual archive transition then succeeds. Existing P1–P20 postevent invariants
verify the result, adjudication, honor, audit and archive policies remain intact.

Integrated consumer and dependency verification remain release requirements. Before final review,
read active trigger definitions and all candidate writers against the exact
integrated source, and run roster/OCR/Demo/financial races. This document and
local barrier success do not claim the Production drain or rollout occurred.

MVP cast currently inserts only votes under the existing match SHARE and has no
audit/season foreign-key edge. It is not classified as a demonstrated reverse
season-lock defect and does not require the OCR evidence helper. MVP settlement
is separate: it updates the winner and inserts an audit and therefore retains
its documented season-first worker boundary.

The Mizar revocation barrier holds the manual writer's actual season/match
locks and contends on source rows. The old revoker's real audit FK closes a
40P01 cycle; the new revoker waits at season before touching any source. The
fixture includes two active sources for the revoked installation and another
installation's source: the former both close, the latter remains open.

Identity merge deliberately uses NOWAIT for the installation/event/match fence
while retaining its existing user locks. Waiting for season while holding user
UPDATE would introduce a new inversion against user SHARE → season admission
and actor foreign-key checks. A busy fence therefore rejects the entire
transaction with a validation error; there is no background or automatic replay.
The preflight fingerprint, authority, immutable actor references, frozen-roster
merge guards and financial-account blockers remain unchanged. Discovery covers
Demo identity dependencies through the canonical predicate and the roster,
participant, registration, stat, MVP, commentator, honor, adjudication, sanction,
award, grant and installation facts that merge can reparent. It includes whole
events and independent match parents; no raw Evidence payload leaves PostgreSQL.

The actual merge and season-retirement callers are driven against real
PostgreSQL in old/new tests. Only the new fence is bypassed in the legacy mode;
all original domain guards, mutations, triggers and wait graphs execute normally.
Both legacy callers reproduce 40P01. New caller contention is placed in a second
event outside the input page, proving complete cross-event discovery. New merge
rolls back before invalidating imports and succeeds only after fresh preflight;
new retirement waits before import/program writes and retains global hard
attribution invalidation. These tests do not mock a PostgreSQL concurrency result.

The PR includes the accounts consumer's roster parent-discovery/authorization
recheck and OCR save/clear parent/map scope checks, adapted to the current main
interface without importing the separate receipt business branch. `castMvpVote`
retains its existing match SHARE implementation. The consumer PG barrier checks
season-first entry before any roster/map child can be retained; archived OCR
remains admitted, mismatched roster scope is rejected, and existing MVP settled
and deadline refusals remain intact. Receipt/CAS behavior is verified separately
in the temporary exact-dependency integration and must be reconciled when that
independent PR lands.

Merge's mutable person-fact rows are also acquired with NOWAIT under the parent
fences before any reparenting. This uses the existing reference-policy registry,
skips preserved actor history and immutable financial accounts, and aborts if a
child-first person-fact owner is busy. A second fingerprint/executable check
under these fences rejects facts changed during unlocked discovery. These
extra reads are a correctness cost for rare identity administration, not a
claimed reduction in merge latency.
