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
| Postmatch | season UPDATE → match UPDATE → report/commentator; explicitly permitted archive channels remain accessible |
| MVP settlement | season UPDATE SKIP LOCKED → match UPDATE SKIP LOCKED → votes read and winner/audit write; preserves nonblocking admission |
| Time auto-award/default lineup | season UPDATE → match UPDATE → proposal/coverage/lineups; ordinary archive guard applies |
| Demo submit/review/recheck/projection repair | existing identity gate → lineage advisory → season UPDATE before any import or match row. Existing import/match suborder is safe only while this exclusive event fence is retained. Empty-lineage advisory and unavailable-target classification remain canonical. |
| Mizar reliable/source | installation SHARE → canonical season/match boundary → live source; display heartbeat is separately committed by the W02 implementation, never upgraded under authority SHARE |
| LIVE broadcast | installation SHARE → match/source SHARE and broadcast inside authority; no event write or lock weakening |
| Roster confirmation (consumer prerequisite) | discover roster parent → season/match → roster UPDATE and recheck association; old child-first entry is incompatible |
| OCR save/clear/MVP vote (consumer prerequisite) | `lockMatchForEvidenceInTx`: season UPDATE → match SHARE → map UPDATE/stat rows, preserving post-event evidence policy; no KEY SHARE substitution |

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

Match-first old workers and season-first new writers can deadlock. Before
releasing this protocol, stop accepting mutable requests and dispatching jobs,
drain old HTTP actions and scheduler/worker transactions, deploy all consumer
changes as one source identity, then resume. A mixed-worker barrier reproduced
40P01; no blind transaction replay is a compatibility mechanism. Rollback uses
the same drain procedure and a consistent old source identity. Do not weaken a
lock as a shortcut for rollout compatibility.

The isolated real-PG barrier holds a season in one connection, observes the
new helper waiting via `pg_blocking_pids`, then takes its match SHARE. It closes
the old deadlock cycle without timers ordering the transactions. A companion
barrier archives the season while the writer waits and proves mutation denial
while explicit inspection remains possible. Different matches within one event
still serialize at the existing UPDATE fence by design.

Consumer prerequisites above are release requirements. The lock helper alone
is not proof that every writer has adopted the protocol. Before final review,
read the current active trigger definitions and all candidate writer families
against the exact integrated source, and run roster/OCR/Demo/financial races.
